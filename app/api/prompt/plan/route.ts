import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { apiRequestSchema, generationProposalSchema, proposalSchema, patchSchema, validateProposal, inputError, type Proposal } from '@/lib/prompt-engine/schema';
import { planningInstructions, revisionInstructions, applyPatch } from '@/lib/prompt-engine/engine';
import { requirementInstructions, requirementSources, extractionSchema, questionsForRequirements, auditInstructions, auditSchema, validateRequirements, requirementGroups, applyRequirementAudit, assertRequirementsRetained, PlanValidationError } from '@/lib/prompt-engine/requirements';
import { withRecovery, generationError, type Attempt } from '@/lib/prompt-engine/recovery';
import { evidenceReviewInstructions, evidenceReviewSchema, applyEvidenceReview, normalizeCreativeEvidence } from '@/lib/prompt-engine/requirements';
import { checkAccess, fail, rateLimit, readBody } from '@/lib/prompt-engine/http';

export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: Request) {
  const denied = checkAccess(request); if (denied) return denied;
  const attempts: Attempt[] = [];
  let stage = 'input';
  try {
    const parsed = apiRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) return fail(inputError(parsed.error, 'api'), 400);
    const input = parsed.data;
    if (!process.env.OPENAI_API_KEY) return fail('AI 연결이 준비되지 않았어요. 서버 연결 설정을 확인해주세요.', 503);
    if (input.action === 'revise') {
      try { validateProposal(input.brief, input.proposal); }
      catch { return fail('저장된 기획의 사진 연결을 확인해주세요.', 400); }
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
    const photoContent = images.flatMap(i => [{ type: 'text' as const, text: `IMAGE ${i.id}: role=${i.role}, name=${i.name}` }, { type: 'file' as const, mediaType: 'image/jpeg', data: i.data }]);
    const imageInfo = images.map(({ id, name, role }) => ({ id, name, role }));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(160_000)]);
    const common = {
      model: openai(model),
      providerOptions: { openai: { store: false, reasoningEffort: 'low' as const } },
      maxRetries: 0, abortSignal: signal,
    };
    const validate = (proposal: Proposal) => {
      try { validateProposal(input.brief, proposal); }
      catch (error) { throw new PlanValidationError(error instanceof Error ? error.message : '사진 연결·컷 수·ID 형식을 다시 확인해주세요.'); }
    };
    if (input.action === 'propose') {
      stage = 'requirements';
      const requestSources = requirementSources(input.brief, input.answers);
      let requirements: NonNullable<Proposal['requirements']> = await withRecovery(stage, async (repair, feedback) => {
        const { output } = await generateText({ ...common, maxOutputTokens: 5000, instructions: requirementInstructions + (repair ? '\nRetry: use existing sourceKey, valid photo IDs and target shot numbers only. Validation issue: ' + feedback : ''),
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ brief, answers: input.answers, requestSources, images: imageInfo }) }, ...photoContent] }],
          output: Output.object({ schema: extractionSchema(requestSources, input.brief) }) });
        const grounded = normalizeCreativeEvidence(input.brief, input.answers, output.requirements.map(({ sourceKey, ...r }) => {
          const source = requestSources.find(s => s.key === sourceKey)!;
          return { ...r, quote: source.text, origin: source.origin };
        }));
        validateRequirements(input.brief, input.answers, grounded);
        return grounded;
      }, signal, attempts);
      const suspects = requirements;
      if (suspects.length) {
        stage = 'evidence_review';
        requirements = await withRecovery(stage, async (repair, feedback) => {
          const { output } = await generateText({ ...common, maxOutputTokens: 5000,
            instructions: evidenceReviewInstructions + (repair ? '\nReturn each suspect exactly once with valid evidence IDs. Validation issue: ' + feedback : ''),
            messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ brief, answers: input.answers, suspects, images: imageInfo }) }, ...photoContent] }],
            output: Output.object({ schema: evidenceReviewSchema(input.brief, suspects) }) });
          return applyEvidenceReview(input.brief, input.answers, requirements, output);
        }, signal, attempts);
      }
      stage = 'planning';
      const questions = questionsForRequirements(input.brief, requirements);
      const outputSchema = generationProposalSchema.omit({ references: true, questions: true }).extend({
        ...(input.brief.images.some(i => i.role === 'reference') ? { references: proposalSchema.shape.references } : {}),
      });
      let proposal: Proposal = await withRecovery(stage, async (repair, feedback) => {
        const { output } = await generateText({ ...common, maxOutputTokens: input.brief.count > 4 ? 24000 : 10000,
          instructions: planningInstructions + (repair ? '\nRetry: ensure valid source IDs, unique IDs and exactly the requested number of shots per direction. Use shorter fields, preserve mandatory requirements. Validation issue: ' + feedback : ''),
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ brief, answers: input.answers, requirements, questions, images: imageInfo }) }, ...photoContent] }],
          output: Output.object({ schema: outputSchema }) });
        const candidate = proposalSchema.parse({ ...output, references: 'references' in output ? output.references : [], questions, requirements });
        validate(candidate);
        return candidate;
      }, signal, attempts);
      const groups = requirementGroups(proposal);
      if (groups.length) {
        stage = 'requirement_audit';
        proposal = await withRecovery(stage, async (repair, feedback) => {
          const { output } = await generateText({ ...common, maxOutputTokens: Math.min(24000, Math.max(5000, groups.length * 450)),
            instructions: auditInstructions + (repair ? '\nRetry: return every group exactly once; include all requirement.text verbatim. Do not omit a group. Validation issue: ' + feedback : ''),
            messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ groups, questions: proposal.questions, images: imageInfo }) }] }],
            output: Output.object({ schema: auditSchema }) });
          const audited = applyRequirementAudit(input.brief, proposal, output); validate(audited); return audited;
        }, signal, attempts);
      }
      assertRequirementsRetained(proposal);
      return Response.json({ proposal, diagnostics: { attempts } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    stage = 'revision';
    const output = await withRecovery(stage, async (repair, feedback) => {
      const { output } = await generateText({ ...common, maxOutputTokens: 10000, instructions: revisionInstructions + '\nPreserve the supplied mandatory requirements in their fields. If the user wants to replace a mandatory requirement, explain that the original request must first be updated. Never silently delete it.' + (repair ? '\nReturn valid unique patch fields and known shot IDs only.' : ''),
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ brief, identity: input.proposal.identity, requirements: input.proposal.requirements, unknowns: input.proposal.unknowns, references: input.proposal.references, currentPlan: input.plan.direction, revisionRequest: input.request }) }, ...photoContent] }],
        output: Output.object({ schema: patchSchema }) });
      return output;
    }, signal, attempts);
    if (output.unresolved.length) return Response.json({ clarification: output.unresolved.join(' '), message: output.message });
    const plan = applyPatch(input.plan, output, input.request);
    try { assertRequirementsRetained({ ...input.proposal, directions: [plan.direction] }); }
    catch { return Response.json({ clarification: '이번 수정은 처음 요청의 필수 조건과 충돌해요. 해당 조건을 바꾸려면 제품·요청 수정에서 먼저 변경해주세요.', message: '기존 계획을 유지했어요.' }); }
    return Response.json({ plan, message: output.message, diagnostics: { attempts } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (stage === 'input' && error instanceof SyntaxError) return fail('요청을 읽지 못했어요. 입력을 확인해주세요.', 400);
    if (error instanceof RangeError) return fail(error.message, 413);
    const result = generationError(error);
    console.warn('[prompt-plan-failed]', { stage, code: result.code });
    return Response.json({ error: result.error, code: result.code, diagnostics: { attempts } }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
