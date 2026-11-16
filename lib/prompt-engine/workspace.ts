import { z } from 'zod';
import { MAX_IMAGES, imageSchema, proposalSchema, planSchema, answerSchema, validateProposal } from './schema.ts';

export const workspaceSchema = z.object({
  version: z.literal(1),
  captureSource: z.object({ id: z.string().uuid(), createdAt: z.string().datetime(), demo: z.boolean(), unresolved: z.array(z.string().max(500)).max(24), imageIds: z.array(z.string()).max(MAX_IMAGES) }).optional(),
  brief: z.object({ request: z.string().max(2000), images: z.array(imageSchema).max(MAX_IMAGES), count: z.number().int().min(1).max(4), ratio: z.enum(['1:1', '4:5', '9:16']) }),
  proposal: proposalSchema.nullable(), plan: planSchema.nullable(),
  answers: z.array(answerSchema).max(6), approvedAt: z.string().datetime().nullable(),
  phase: z.enum(['brief', 'directions', 'plan']),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyWorkspace: Workspace = { version: 1, brief: { request: '', images: [], count: 1, ratio: '1:1' }, proposal: null, plan: null, answers: [], approvedAt: null, phase: 'brief' };
export function restoreWorkspace(raw: unknown): Workspace {
  const w = workspaceSchema.parse(raw);
  if (w.proposal) validateProposal(w.brief, w.proposal);
  if (w.phase !== 'brief' && !w.proposal) throw new Error('저장된 제안이 없어요.');
  if (w.phase === 'plan' && (!w.plan || w.proposal?.questions.length)) throw new Error('저장된 계획이 올바르지 않아요.');
  if (w.plan) {
    const original = w.proposal?.directions.find(d => d.id === w.plan?.direction.id);
    if (!original || JSON.stringify(original.shots.map(s => [s.id, s.sourceIds])) !== JSON.stringify(w.plan.direction.shots.map(s => [s.id, s.sourceIds]))) throw new Error('저장된 원본 연결이 맞지 않아요.');
  }
  if (w.approvedAt && (!w.plan || w.phase !== 'plan' || w.proposal?.questions.length)) throw new Error('확정 상태가 올바르지 않아요.');
  return w;
}
