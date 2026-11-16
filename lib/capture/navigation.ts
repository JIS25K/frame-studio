import { duplicateDistance, type Quality } from './quality.ts';

export type RotationDirection = 'right' | 'left';
export type CaptureStage = 'rotate' | 'supplement';
export type RegionBox = { x: number; y: number; width: number; height: number };
export function validRegionBox(box: RegionBox | null | undefined): RegionBox | null {
  if (!box || !Object.values(box).every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 || box.y + box.height > 1) return null;
  return box;
}
export function rotationInstruction(direction: RotationDirection) {
  return `기준 정면이 화면 ${direction === 'right' ? '오른쪽' : '왼쪽'}으로 돌아가게 돌려주세요.`;
}
export type MotionState = { rate: number; stillSince: number | null; at: number };
// Image change is a relative cue, not angular velocity or object pose. Brightness/quality wins.
export function motionFeedback(q: Quality, at: number, previous: { quality: Quality; at: number } | null, state: MotionState | null) {
  const dt = previous ? at - previous.at : 0;
  const valid = !!previous && dt > 0 && dt <= 1000;
  const raw = valid ? duplicateDistance(q.fingerprint, previous!.quality.fingerprint) / (dt / 1000) : 0;
  const rate = valid ? (state ? state.rate * .65 + raw * .35 : raw) : 0;
  const stillSince = valid && rate < .008 ? state?.stillSince ?? at : null;
  const next = { rate, stillSince, at };
  const lightChange = valid && Math.abs(q.brightness - previous!.quality.brightness) / (dt / 1000) > 32;
  const message = q.issues[0] || (lightChange ? '조명을 일정하게 유지해주세요.' : rate > .18 ? '조금 더 천천히 돌려주세요.' : stillSince !== null && at - stillSince > 2000 ? '같은 방향으로 조금 더 돌려주세요.' : valid ? '지금처럼 천천히 움직여주세요.' : '천천히 회전을 시작해주세요.');
  return { state: next, message, level: q.issues.length || lightChange ? 'quality' : rate > .18 ? 'fast' : stillSince !== null && at - stillSince > 2000 ? 'still' : 'steady' };
}
export type CaptureEvent = { at: number; reason: string; detail: string };
export const SESSION_LIMITS = { segmentSeconds: 90, segmentCalls: 18, totalCalls: 54, videoBytes: 30 * 1024 * 1024 };
