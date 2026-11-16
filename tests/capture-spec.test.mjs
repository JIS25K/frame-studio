import test from 'node:test';
import assert from 'node:assert/strict';
import { specSchema, sixViewSpec, exampleSpecs, qualifies, advanceConfirmation, verdictSchema } from '../lib/capture/spec.ts';
const target = exampleSpecs[0].requirements[1];
const pass = { observedView: 'side', sameProduct: 'yes', framingMatches: true, matchesTarget: true, confidence: .93, visibleParts: ['옆면'], missingParts: [], evidence: '앞면 대신 옆면 전체가 보임', guidance: '그대로 멈춰주세요.' };
test('external capture contracts require unique IDs and an initial full front reference', () => {
  for (const spec of exampleSpecs) assert.ok(specSchema.safeParse(spec).success);
  const copy = structuredClone(exampleSpecs[0]); copy.requirements[1].id = 'front'; assert.equal(specSchema.safeParse(copy).success, false);
  copy.requirements.shift(); assert.equal(specSchema.safeParse(copy).success, false);
});
test('wrong view, unidentified product, missing parts and uncertainty never pass even if model says matched', () => {
  assert.equal(qualifies(pass, target, true), true);
  for (const patch of [{ observedView: 'front' }, { sameProduct: 'uncertain' }, { sameProduct: 'no' }, { sameProduct: 'no_reference' }, { missingParts: ['노즐'] }, { confidence: .84 }, { framingMatches: false }])
    assert.equal(qualifies({ ...pass, ...patch }, target, true), false);
});
test('two consecutive matches are required; a mismatch clears the streak', () => {
  assert.equal(advanceConfirmation(0, pass, target, true), 1);
  assert.equal(advanceConfirmation(1, pass, target, true), 2);
  assert.equal(advanceConfirmation(1, { ...pass, observedView: 'unknown' }, target, true), 0);
});
test('front bootstrap cannot pretend an unprovided reference exists', () => {
  const front = exampleSpecs[0].requirements[0];
  const v = { ...pass, observedView: 'front', sameProduct: 'no_reference' };
  assert.equal(qualifies(v, front, false), true);
  assert.equal(qualifies({ ...v, sameProduct: 'yes' }, front, false), false);
  assert.equal(verdictSchema.safeParse({ ...pass, confidence: 42 }).success, false);
});

test('fixed coverage route includes six distinct directions and rejects mirrored sides', () => {
  assert.ok(specSchema.safeParse(sixViewSpec).success);
  assert.deepEqual(sixViewSpec.requirements.map(r => r.view), ['front', 'right', 'back', 'left', 'top', 'bottom']);
  const left = sixViewSpec.requirements[3];
  assert.equal(qualifies({ ...pass, observedView: 'right' }, left, true), false);
  assert.equal(qualifies({ ...pass, observedView: 'left' }, left, true), true);
  assert.equal(qualifies({ ...pass, observedView: 'unknown', sameProduct: 'uncertain' }, left, true), false);
});
