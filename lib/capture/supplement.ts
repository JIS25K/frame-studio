import { validRegionBox, type RegionBox } from './navigation.ts';
import type { Observation } from './observation';
import type { Quality } from './quality.ts';

export type CaptureFrame = { image: string; quality: Quality; at: number };
export type SupplementKind = 'repeated' | 'blurred' | 'occluded';
export type Supplement = {
  id: string;
  kind: SupplementKind;
  region: string;
  reason: string;
  box?: RegionBox | null;
  source: 'local-quality' | 'model';
  status: 'open' | 'improved' | 'deferred';
  anchor: CaptureFrame;
  support: CaptureFrame | null;
  events: { at: number; event: string; reason: string }[];
};
export const SUPPLEMENT_POLICY = { version: 1, blurDurationMs: 1000, maxSampleGapMs: 750, maxTasks: 24 };
export const SUPPLEMENT_LABELS = { repeated: '같은 쪽 반복', blurred: '흐림 의심', occluded: '가려진 부분' };

export function localBlur(quality: Quality) {
  // Low texture can also cause this signal. Do not call it confirmed blur or a named face.
  return quality.sharpness < 45 && quality.brightness >= 38 && quality.brightness <= 246 && quality.dark <= .65 && quality.light <= .45;
}

export function openSupplement(tasks: Supplement[], kind: SupplementKind, frame: CaptureFrame, region: string, reason: string, source: Supplement['source'], box?: RegionBox | null): Supplement[] {
  if (tasks.length >= SUPPLEMENT_POLICY.maxTasks) return tasks;
  // A local blur episode cannot identify a region. Keep its original anchor until reviewed.
  if (source === 'local-quality' && tasks.some(t => t.status === 'open' && t.kind === 'blurred')) return tasks;
  if (tasks.some(t => t.status === 'open' && t.kind === kind && t.region === region)) return tasks;
  return [...tasks, { id: `supplement-${tasks.length + 1}`, kind, region, reason, source, box: validRegionBox(box), status: 'open', anchor: frame, support: null, events: [{ at: frame.at, event: 'opened', reason }] }];
}

export function nextSupplement(tasks: Supplement[]) {
  // Address visible quality/occlusion before asking for additional rotation.
  return tasks.find(t => t.status === 'open' && t.kind !== 'repeated') ?? tasks.find(t => t.status === 'open');
}

export function supplementGuidance(task: Supplement) {
  if (task.kind === 'repeated') return '같은 쪽이 반복돼 보여요. 제품을 같은 방향으로 조금 더 천천히 돌려주세요.';
  if (task.kind === 'blurred') return '작은 사진의 장면을 다시 보여주세요. 초점을 맞추고 천천히 움직여주세요.';
  return task.box ? '표시한 부분이 보이도록 손 위치나 기울기를 조금 바꿔주세요.' : '사진의 장면을 다시 보여주세요. 가린 손을 옮겨주세요.';
}

export function applySupplementObservation(tasks: Supplement[], frame: CaptureFrame, observation: Observation, targetId: string | null, localUsable: boolean) {
  const inspection = observation.inspection;
  let improvedId: string | null = null;
  let next = tasks;
  const target = tasks.find(t => t.id === targetId && t.status === 'open');
  // Absence of a gap or elapsed time NEVER resolves a task. Only a targeted comparison can.
  if (target && inspection) {
    const matching = target.kind === 'repeated'
      ? inspection.targetCheck === 'new_view' && observation.addsInformation
      : inspection.targetCheck === 'same_region_clear';
    const clear = matching && localUsable && observation.usable && observation.sameProduct === 'yes'
      && inspection.issue === 'none' && frame.at > target.anchor.at && frame.image !== target.anchor.image;
    next = tasks.map(t => t.id !== target.id ? t : {
      ...t, status: clear ? 'improved' : t.status, support: clear ? frame : t.support,
      events: [...t.events, { at: frame.at, event: clear ? 'improved-model-estimate' : 'checked', reason: `${inspection.targetCheck}: ${inspection.evidence}` }],
    });
    if (clear) improvedId = target.id;
  }
  if (inspection && ['repeated', 'blurred', 'occluded'].includes(inspection.issue)
      && (observation.sameProduct === 'yes' || observation.sameProduct === 'no_reference')) {
    const kind = inspection.issue as SupplementKind;
    // Do not turn uncertainty/no-novelty alone into a claim of repeat or occlusion.
    const grounded = inspection.evidence.trim() && inspection.region.trim()
      && (kind !== 'repeated' || (observation.sameProduct === 'yes' && !observation.addsInformation && observation.usable));
    const sameOpenTarget = target && kind === target.kind && inspection.targetCheck === 'still_blocked';
    if (grounded && !sameOpenTarget) next = openSupplement(next, kind, frame, inspection.region, inspection.evidence, 'model', inspection.box);
  }
  return { tasks: next, improvedId };
}

export function deferSupplement(tasks: Supplement[], id: string, at: number) {
  return tasks.map(t => t.id === id && t.status === 'open' ? { ...t, status: 'deferred' as const, events: [...t.events, { at, event: 'deferred', reason: '사용자가 보충 촬영을 보류함. 미확보 상태 유지.' }] } : t);
}

export function excludeSupplementEvidence(tasks: Supplement[], at: number) {
  return tasks.map(t => t.support?.at === at ? { ...t, status: 'open' as const, support: null, events: [...t.events, { at, event: 'reopened', reason: '사용자가 보충 근거 사진을 제외함.' }] } : t);
}
