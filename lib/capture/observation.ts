import { z } from 'zod';
import { duplicateDistance, type Quality } from './quality';

export const regionBoxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) });

export const inspectionSchema = z.object({
  issue: z.enum(['none', 'repeated', 'blurred', 'occluded', 'uncertain']),
  region: z.string().max(120),
  box: regionBoxSchema.nullable().optional(),
  evidence: z.string().max(240),
  targetCheck: z.enum(['not_requested', 'same_region_clear', 'new_view', 'still_blocked', 'different_region', 'uncertain']),
});

export const observationSchema = z.object({
  usable: z.boolean(),
  sameProduct: z.enum(['yes', 'no', 'uncertain', 'no_reference']),
  addsInformation: z.boolean(),
  shape: z.enum(['flat', 'volumetric', 'symmetric', 'unknown']),
  description: z.string().min(1).max(240),
  newDetails: z.array(z.string().max(120)).max(5),
  visibleGaps: z.array(z.string().max(120)).max(5),
  action: z.enum(['rotate', 'reverse', 'tilt', 'adjust', 'review']),
  guidance: z.string().min(1).max(180),
  // Older recordings remain readable; only the new server output requires inspection.
  inspection: inspectionSchema.optional(),
});
export const observationOutputSchema = observationSchema.extend({ inspection: inspectionSchema.extend({ box: regionBoxSchema.nullable() }) });
export type Observation = z.infer<typeof observationSchema>;
export function keepObservation(o: Observation, hasReference: boolean) {
  // A usable first scene establishes the baseline; novelty is only meaningful after that.
  return o.usable && (hasReference ? o.addsInformation && o.sameProduct === 'yes' : o.sameProduct === 'no_reference' && o.newDetails.length > 0);
}
export const ORBIT_POLICY = { seconds: 90, maxCalls: 18, intervalMs: 3500, maxChangePerSecond: .3, maxBrightnessChangePerSecond: 32, noveltyDistance: .025, revisitMs: 8000 };
export function continuousQuality(q: Quality, at: number, previous: { quality: Quality; at: number } | null) {
  const dt = previous ? at - previous.at : 0;
  const rate = previous && dt > 0 && dt <= 1000 ? duplicateDistance(q.fingerprint, previous.quality.fingerprint) / (dt / 1000) : null;
  const brightnessRate = previous && dt > 0 && dt <= 1000 ? Math.abs(q.brightness - previous.quality.brightness) / (dt / 1000) : null;
  const reason = q.issues[0] || ((brightnessRate ?? 0) > ORBIT_POLICY.maxBrightnessChangePerSecond ? '밝기가 바뀌고 있어요. 조명을 일정하게 해주세요.' : (rate ?? 0) > ORBIT_POLICY.maxChangePerSecond ? '조금만 더 천천히 돌려주세요.' : '');
  return { usable: !reason, reason, rate, brightnessRate };
}
