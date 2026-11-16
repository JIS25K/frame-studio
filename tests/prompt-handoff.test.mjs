import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoff, importHandoff, needsImportChoice, handoffSchema } from '../lib/prompt-engine/handoff.ts';
import { emptyWorkspace, restoreWorkspace } from '../lib/prompt-engine/workspace.ts';
import { briefSchema } from '../lib/prompt-engine/schema.ts';
const options = { id: 'b53cf65e-f792-4be6-9842-90c759d47ea0', createdAt: '2026-11-16T00:00:00.000Z', reviewed: true, demo: false, unresolved: ['뒷면 가림 의심'], frames: Array.from({ length: 18 }, (_, n) => ({ image: `data:image/jpeg;base64,${Buffer.from(`jpeg-${n}`).toString('base64')}`, at: n * 3500, description: `선별 장면 ${n}` })) };
test('all 18 selected capture frames transfer with stable source IDs and no re-upload', () => {
  const packet = createHandoff(options), work = importHandoff(packet);
  assert.equal(work.brief.images.length, 18);
  assert.deepEqual(work.brief.images.map(i => i.data), options.frames.map(i => i.image));
  assert.equal(new Set(work.brief.images.map(i => i.id)).size, 18);
  assert.equal(work.brief.request, '');
  assert.deepEqual(work.captureSource.unresolved, options.unresolved);
  assert.equal(restoreWorkspace(work).captureSource.id, packet.id);
  assert.equal(briefSchema.safeParse({ ...work.brief, request: '차분한 세럼 광고' }).success, true);
});
test('duplicate supplementary evidence is transferred once; empty and unreviewed capture rejected', () => {
  assert.equal(createHandoff({ ...options, frames: [...options.frames, options.frames[0]] }).images.length, 18);
  assert.throws(() => createHandoff({ ...options, reviewed: false }));
  assert.throws(() => createHandoff({ ...options, frames: [] }));
  const packet = createHandoff(options);
  assert.equal(handoffSchema.safeParse({ ...packet, images: [packet.images[0], packet.images[0]] }).success, false);
});
test('existing work requires a choice, same handoff is idempotent and legacy drafts remain readable', () => {
  const packet = createHandoff(options);
  assert.equal(needsImportChoice(emptyWorkspace, packet), false);
  assert.equal(needsImportChoice({ ...emptyWorkspace, brief: { ...emptyWorkspace.brief, request: '진행 중인 작업' } }, packet), true);
  assert.equal(needsImportChoice(importHandoff(packet), packet), false);
  assert.equal(restoreWorkspace(emptyWorkspace).captureSource, undefined);
});
