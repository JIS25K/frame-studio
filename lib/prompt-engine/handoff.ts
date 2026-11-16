import { z } from 'zod';
import { imageSchema, MAX_IMAGES } from './schema.ts';
import { emptyWorkspace, type Workspace } from './workspace.ts';
export const handoffSchema = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(), demo: z.boolean(),
  images: z.array(imageSchema).min(1).max(MAX_IMAGES),
  unresolved: z.array(z.string().max(500)).max(24),
}).superRefine((p, ctx) => {
  if (p.images.some(i => i.role !== 'product') || new Set(p.images.map(i => i.id)).size !== p.images.length)
    ctx.addIssue({ code: 'custom', message: '촬영 사진 연결이 올바르지 않아요.' });
});
export type CaptureHandoff = z.infer<typeof handoffSchema>;
export function createHandoff(input: { id: string; createdAt: string; reviewed: boolean; demo: boolean; frames: { image: string; at: number; description: string }[]; unresolved: string[] }): CaptureHandoff {
  if (!input.reviewed) throw new Error('선별된 장면을 먼저 확인해주세요.');
  const seen = new Set<string>();
  const frames = input.frames.filter(f => { if (seen.has(f.image)) return false; seen.add(f.image); return true; });
  return handoffSchema.parse({ id: input.id, createdAt: input.createdAt, demo: input.demo, unresolved: input.unresolved,
    images: frames.map((f, i) => ({ id: `capture-${input.id.slice(0, 8)}-${i + 1}`, name: `${input.demo ? '체험' : '촬영'} ${i + 1} · ${f.description}`.slice(0, 150), role: 'product', data: f.image })) });
}
export function needsImportChoice(work: Workspace, packet: CaptureHandoff) {
  return work.captureSource?.id !== packet.id && Boolean(work.brief.images.length || work.brief.request.trim() || work.proposal || work.plan);
}
export function importHandoff(packet: CaptureHandoff): Workspace {
  const p = handoffSchema.parse(packet);
  return { ...emptyWorkspace, brief: { ...emptyWorkspace.brief, images: p.images }, captureSource: { id: p.id, createdAt: p.createdAt, demo: p.demo, unresolved: p.unresolved, imageIds: p.images.map(i => i.id) } };
}
