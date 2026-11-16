import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchema, patchSchema, validateProposal } from '../lib/prompt-engine/schema.ts';
import { applyPatch, compilePrompts, makePackage } from '../lib/prompt-engine/engine.ts';
import { emptyWorkspace, restoreWorkspace } from '../lib/prompt-engine/workspace.ts';

export const brief = { request: '깨끗한 제품 광고', images: [{ id: 'front', role: 'product', name: '원본', data: 'data:image/jpeg;base64,/9j/AA==' }, { id: 'style', role: 'reference', name: '연출', data: 'data:image/jpeg;base64,/9j/AA==' }], count: 2, ratio: '1:1' };
const shot = { id: 'shot1', title: '정면 컷', sourceIds: ['front', 'style'], purpose: '제품 형태', background: '아이보리 벽', composition: '제품 한 병 정면', lighting: '좌측 부드러운 빛', props: '없음', action: '정지', copy: '없음' };
export const proposal = { productName: 'LUMI', observation: '초록색 용기', identity: [{ text: '초록색 병', sourceIds: ['front'] }], unknowns: ['뒷면 미확인'], references: [{ imageId: 'style', use: '배경', exclude: '갈색 병' }], questions: [], directions: [{ id: 'a', title: '깨끗함', summary: '밝은 정면', reason: '제품 강조', palette: ['#ffffff', '#eeeeee', '#cccccc'], shots: [shot, { ...shot, id: 'shot2', title: '디테일' }] }] };
export const plan = { direction: proposal.directions[0], revision: 1, history: [] };

test('input requires an original product and rejects external image URLs, duplicate ids and excess images', () => {
  assert.equal(briefSchema.safeParse(brief).success, true);
  assert.equal(briefSchema.safeParse({ ...brief, images: brief.images.slice(1) }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, images: [...brief.images, brief.images[0]] }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, images: [{ ...brief.images[0], data: 'https://example.com/photo.jpg' }] }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, count: 13 }).success, false);
});
test('proposal validates original/reference roles and exact requested shot count', () => {
  assert.doesNotThrow(() => validateProposal(brief, proposal));
  assert.throws(() => validateProposal(brief, { ...proposal, identity: [{ text: '갈색 병', sourceIds: ['style'] }] }));
  assert.throws(() => validateProposal({ ...brief, count: 3 }, proposal));
  assert.throws(() => validateProposal(brief, { ...proposal, directions: [{ ...plan.direction, shots: [shot, shot] }] }));
});
test('background-only patch preserves all other fields, other cuts and original plan', () => {
  const patch = { message: '배경만 변경', unresolved: [], edits: [{ shotId: 'shot1', field: 'background', value: '연한 파란 벽' }] };
  const revised = applyPatch(plan, patch, '1번 배경만 파랑');
  assert.deepEqual(revised.direction.shots[0], { ...shot, background: '연한 파란 벽' });
  assert.deepEqual(revised.direction.shots[1], plan.direction.shots[1]);
  assert.equal(plan.direction.shots[0].background, '아이보리 벽');
  assert.equal(revised.revision, 2);
  assert.equal(revised.history[0].changes[0].before, '아이보리 벽');
});
test('patch cannot change identity, invent cut IDs, duplicate fields or apply unresolved ambiguity', () => {
  assert.equal(patchSchema.safeParse({ message: '변경', unresolved: [], edits: [{ shotId: 'shot1', field: 'sourceIds', value: 'other' }] }).success, false);
  const edit = { shotId: 'shot1', field: 'background', value: '파랑' };
  assert.throws(() => applyPatch(plan, { message: '변경', unresolved: ['어느 컷?'], edits: [edit] }, '배경'));
  assert.throws(() => applyPatch(plan, { message: '변경', unresolved: [], edits: [{ ...edit, shotId: 'missing' }] }, '배경'));
  assert.throws(() => applyPatch(plan, { message: '변경', unresolved: [], edits: [edit, edit] }, '배경'));
});
test('export requires explicit approval with no pending questions and retains original photos', () => {
  assert.throws(() => makePackage(brief, proposal, plan, null));
  const pending = { ...proposal, questions: [{ id: 'which', question: '제품?', reason: '둘', options: ['왼쪽', '오른쪽'] }] };
  assert.throws(() => makePackage(brief, pending, plan, new Date().toISOString()));
  const result = makePackage(brief, proposal, plan, new Date().toISOString());
  assert.deepEqual(result.originalBrief.images, brief.images);
  assert.equal(result.prompts.length, 2);
  const prompts = compilePrompts(brief, proposal, plan);
  assert.match(prompts[0].prompt, /갈색 병/);
  assert.match(prompts[0].prompt, /초록색 병/);
});
test('saved workspace restores approved work and rejects corrupt/stale identity mappings', () => {
  const work = { ...emptyWorkspace, brief, proposal, plan, phase: 'plan', approvedAt: new Date().toISOString() };
  assert.deepEqual(restoreWorkspace(work), work);
  assert.throws(() => restoreWorkspace({ ...work, proposal: null }));
  assert.throws(() => restoreWorkspace({ ...work, plan: { ...plan, direction: { ...plan.direction, shots: [{ ...shot, sourceIds: ['missing'] }] } } }));
  assert.deepEqual(restoreWorkspace(emptyWorkspace), emptyWorkspace);
});
