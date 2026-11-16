import { z } from 'zod';
import {videoContextSchema} from './video-context.ts';

export const MAX_IMAGES = 24;
export const MAX_REQUEST_LENGTH = 12000;
export const MAX_SHOTS = 12;
const short = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const imageSchema = z.object({
  id, name: z.string().max(150), role: z.enum(['product', 'reference']),
  data: z.string().max(900_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
});
export const briefSchema = z.object({
  videoContext: videoContextSchema.optional(),
  request: z.string().trim().min(3).max(MAX_REQUEST_LENGTH),
  images: z.array(imageSchema).min(1).max(MAX_IMAGES),
  count: z.number().int().min(1).max(MAX_SHOTS), ratio: z.enum(['1:1', '4:5', '9:16']),
}).superRefine((brief, ctx) => {
  if (!brief.images.some(i => i.role === 'product')) ctx.addIssue({ code: 'custom', message: '제품 사진이 필요해요.' });
  if (new Set(brief.images.map(i => i.id)).size !== brief.images.length) ctx.addIssue({ code: 'custom', message: '사진 ID가 중복됐어요.' });
});

export const shotFields = ['purpose', 'background', 'composition', 'lighting', 'props', 'action', 'copy'] as const;
export const fieldLabels: Record<typeof shotFields[number], string> = {
  purpose: '컷의 목적', background: '배경', composition: '구도', lighting: '빛', props: '소품', action: '제품·손 동작', copy: '추가 문구',
};
export const requirementSchema = z.object({
  id, quote: z.string().trim().min(1).max(500), origin: z.enum(['request', 'answer']),
  text: z.string().trim().min(1).max(180), field: z.enum(shotFields),
  // Empty targetShots means every shot; numbered shot types retain their own slot.
  targetShots: z.array(z.number().int().min(1).max(MAX_SHOTS)).max(MAX_SHOTS),
  sourceIds: z.array(id).max(MAX_IMAGES),
  evidence: z.enum(['visible', 'missing', 'not_needed']).optional(),
});
export const requirementsSchema = z.object({ requirements: z.array(requirementSchema.extend({ evidence: z.enum(['visible', 'missing', 'not_needed']) })).max(24) });
export type Requirement = z.infer<typeof requirementSchema>;
export const shotSchema = z.object({
  id, title: z.string().min(1).max(70), sourceIds: z.array(id).min(1).max(MAX_IMAGES),
  purpose: short, background: short, composition: short, lighting: short, props: short, action: short, copy: short,
});
export const directionSchema = z.object({
  id, title: z.string().min(1).max(60), summary: short, reason: short,
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3),
  shots: z.array(shotSchema).min(1).max(MAX_SHOTS),
});
export const proposalSchema = z.object({
  requirements: z.array(requirementSchema).max(24).optional(),
  productName: z.string().min(1).max(120),
  observation: short,
  identity: z.array(z.object({ text: short, sourceIds: z.array(id).min(1).max(MAX_IMAGES) })).min(1).max(8),
  unknowns: z.array(short).max(5),
  references: z.array(z.object({ imageId: id, use: short, exclude: short })).max(MAX_IMAGES),
  questions: z.array(z.object({ id, question: short, reason: short, options: z.array(short).min(2).max(3) })).max(2),
  directions: z.array(directionSchema).min(1).max(3),
});
// Initial generation must offer a choice; saved plans remain readable if a previous version had one direction.
export const generationProposalSchema = proposalSchema.omit({ requirements: true }).extend({ directions: z.array(directionSchema).min(2).max(3) });
export const answerSchema = z.object({ question: short, answer: short });
export const patchSchema = z.object({
  message: short,
  edits: z.array(z.object({ shotId: id, field: z.enum(shotFields), value: short })).max(MAX_SHOTS * shotFields.length),
  unresolved: z.array(short).max(3),
});
export const planSchema = z.object({
  direction: directionSchema, revision: z.number().int().min(1).max(100),
  history: z.array(z.object({ revision: z.number().int(), request: z.string().max(1000), changes: z.array(z.object({ shotId: id, field: z.enum(shotFields), before: short, after: short })).max(MAX_SHOTS * shotFields.length) })).max(99),
});
export const apiRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('propose'), brief: briefSchema, answers: z.array(answerSchema).max(6) }),
  z.object({ action: z.literal('revise'), brief: briefSchema, proposal: proposalSchema, plan: planSchema, request: z.string().trim().min(2).max(1000) }),
]);
export type Brief = z.infer<typeof briefSchema>;
export type ProductImage = z.infer<typeof imageSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type Answer = z.infer<typeof answerSchema>;

// A model may return structurally valid JSON with wrong IDs or a wrong shot count.
export function validateProposal(brief: Brief, proposal: Proposal): void {
  const productIds = new Set(brief.images.filter(i => i.role === 'product').map(i => i.id));
  const allIds = new Set(brief.images.map(i => i.id));
  if (proposal.identity.some(f => f.sourceIds.some(i => !productIds.has(i)))) throw new Error('제품 관찰의 사진 근거가 맞지 않아요.');
  if (new Set(proposal.directions.map(d => d.id)).size !== proposal.directions.length) throw new Error('연출 ID가 중복됐어요.');
  if (new Set(proposal.questions.map(q => q.id)).size !== proposal.questions.length) throw new Error('질문 ID가 중복됐어요.');
  if (proposal.references.some(r => !brief.images.some(i => i.id === r.imageId && i.role === 'reference'))) throw new Error('레퍼런스 연결이 맞지 않아요.');
  for (const d of proposal.directions) {
    if (d.shots.length !== brief.count || new Set(d.shots.map(s => s.id)).size !== d.shots.length) throw new Error('컷 구성이 요청과 맞지 않아요.');
    if (d.shots.some(s => !s.sourceIds.some(i => productIds.has(i)) || s.sourceIds.some(i => !allIds.has(i)))) throw new Error('컷의 제품 원본 연결이 맞지 않아요.');
  }
}

// Shared by browser and API so boundary errors identify the actual constraint.
export function inputError(error: z.ZodError, context: 'brief' | 'api' = 'brief'): string {
  const issue = error.issues[0];
  const path = issue.path.join('.');
  if (context === 'api' && path === 'request') return '수정 요청은 2~1,000자로 입력해주세요.';
  if (path.endsWith('request')) return `요청은 3~${MAX_REQUEST_LENGTH.toLocaleString('ko-KR')}자로 입력해주세요. 긴 상품 설명도 함께 넣을 수 있어요.`;
  if (path.endsWith('count')) return `한 번에 1~${MAX_SHOTS}장을 기획할 수 있어요. 장수를 조정해주세요.`;
  if (path.includes('images')) return `제품 사진이 필요해요. 제품과 레퍼런스를 합쳐 최대 ${MAX_IMAGES}장까지 JPEG 분석용 사진으로 넣어주세요.`;
  if (issue.code === 'custom') return issue.message;
  return '입력 형식을 확인해주세요. 사진·요청·장수 정보를 다시 확인해주세요.';
}
