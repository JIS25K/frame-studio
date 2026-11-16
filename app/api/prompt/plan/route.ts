import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { apiRequestSchema, generationProposalSchema, patchSchema, validateProposal } from '@/lib/prompt-engine/schema';
import { planningInstructions, revisionInstructions, applyPatch } from '@/lib/prompt-engine/engine';
import { checkAccess, fail, rateLimit, readBody } from '@/lib/prompt-engine/http';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = checkAccess(request); if (denied) return denied;
  if (!process.env.OPENAI_API_KEY) return fail('AI 연결이 준비되지 않았어요. 서버에 OPENAI_API_KEY를 설정해주세요.', 503);
  try {
    const parsed = apiRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) return fail('사진 또는 요청 형식을 확인해주세요. 제품 사진과 세 글자 이상의 요청이 필요해요.', 400);
    const input = parsed.data;
    if (input.action === 'revise') {
      validateProposal(input.brief, input.proposal);
      const original = input.proposal.directions.find(d => d.id === input.plan.direction.id);
      if (!original || input.proposal.questions.length || input.plan.direction.shots.length !== input.brief.count ||
        JSON.stringify(original.shots.map(s => [s.id, s.sourceIds])) !== JSON.stringify(input.plan.direction.shots.map(s => [s.id, s.sourceIds]))) {
        return fail('확인된 연출과 원본 사진을 기준으로 다시 선택해주세요.', 400);
      }
    }
    const limited = rateLimit(request); if (limited) return limited;
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.PROMPT_MODEL || 'gpt-5.4-mini';
    const { images, ...brief } = input.brief;
    const content = [
      { type: 'text' as const, text: JSON.stringify({ brief, images: images.map(({ id, name, role }) => ({ id, name, role })),
        ...(input.action === 'propose' ? { answers: input.answers } : { identity: input.proposal.identity, unknowns: input.proposal.unknowns, references: input.proposal.references, currentPlan: input.plan.direction, revisionRequest: input.request }) }) },
      ...images.flatMap(i => [{ type: 'text' as const, text: `IMAGE ${i.id}: role=${i.role}, name=${i.name}` }, { type: 'file' as const, mediaType: 'image/jpeg', data: i.data }]),
    ];
    const common = {
      model: openai(model), messages: [{ role: 'user' as const, content }],
      providerOptions: { openai: { store: false, reasoningEffort: 'low' as const } },
      maxOutputTokens: 6500, maxRetries: 0,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
    };
    if (input.action === 'propose') {
      const { output } = await generateText({ ...common, instructions: planningInstructions, output: Output.object({ schema: generationProposalSchema }) });
      validateProposal(input.brief, output);
      return Response.json({ proposal: output }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { output } = await generateText({ ...common, instructions: revisionInstructions, output: Output.object({ schema: patchSchema }) });
    if (output.unresolved.length) return Response.json({ clarification: output.unresolved.join(' '), message: output.message });
    const plan = applyPatch(input.plan, output, input.request);
    return Response.json({ plan, message: output.message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return fail('요청을 읽지 못했어요. 입력을 확인해주세요.', 400);
    if (error instanceof RangeError) return fail(error.message, 413);
    // Never expose provider payloads, images, credentials or stack traces.
    return fail('AI가 계획을 완성하지 못했어요. 연결 상태를 확인하고 다시 시도해주세요. 기존 계획은 유지됩니다.', 502);
  }
}
