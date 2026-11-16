export type Quality = { sharpness: number; brightness: number; dark: number; light: number; fingerprint: number[]; issues: string[] };

// Evaluate the center guide region, not a claim of object segmentation.
export function analyzePixels(data: Uint8ClampedArray, width: number, height: number): Quality {
  const gray = new Float64Array(width * height);
  let sum = 0, dark = 0, light = 0, energy = 0, mean = 0, n = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
    gray[i] = v; sum += v; if (v < 18) dark++; if (v > 248) light++;
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
    energy += l * l; mean += l; n++;
  }
  const sharpness = Math.max(0, energy / n - (mean / n) ** 2);
  const brightness = sum / gray.length;
  const fingerprint = [];
  for (let by = 0; by < 12; by++) for (let bx = 0; bx < 12; bx++) {
    let total = 0, count = 0;
    for (let y = Math.floor(by * height / 12); y < Math.floor((by + 1) * height / 12); y++)
      for (let x = Math.floor(bx * width / 12); x < Math.floor((bx + 1) * width / 12); x++) { total += gray[y * width + x]; count++; }
    fingerprint.push(total / count / 255);
  }
  const issues: string[] = [];
  if (brightness < 38 || dark / gray.length > CAPTURE_QUALITY_LIMITS.maxClippedDarkFraction) issues.push('제품이 너무 어두워요. 밝은 곳으로 옮겨주세요.');
  if (brightness > 246 || light / gray.length > CAPTURE_QUALITY_LIMITS.maxClippedLightFraction) issues.push('밝은 부분의 정보가 사라지고 있어요. 직사광이나 반사를 줄여주세요.');
  if (sharpness < 45) issues.push('선명한 경계가 부족해요. 제품에 초점을 맞추고 잠시 멈춰주세요.');
  return { sharpness, brightness, dark: dark / gray.length, light: light / gray.length, fingerprint, issues };
}

export function duplicateDistance(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return Infinity;
  return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
}

export type View = 'front' | 'side' | 'oblique';
export function requiredViews(preset: 'front' | 'angle'): View[] {
  return preset === 'front' ? ['front'] : ['front', 'side', 'oblique'];
}

// Prototype thresholds, intentionally exported with each session for calibration.
// Image-change rates are not physical angular velocity; lighting/background can affect them.
export const CAPTURE_QUALITY_LIMITS = { holdMs: 2000, maxGapMs: 750, stillChangePerSecond: .12, maxHoldDrift: .06, motionGraceMs: 500, fastChangePerSecond: .22, maxBrightnessChangePerSecond: 18, maxClippedLightFraction: .45, maxClippedDarkFraction: .65 };
export type MotionState = { at: number; quality: Quality; heldMs: number; anchor: number[] | null; unsettledMs: number; epoch: number };
export function evaluateCaptureFrame(quality: Quality, at: number, previous: MotionState | null) {
  const limits = CAPTURE_QUALITY_LIMITS;
  const dt = previous ? at - previous.at : 0;
  const measurable = Boolean(previous && dt > 0 && dt <= limits.maxGapMs);
  const changePerSecond = measurable ? duplicateDistance(previous!.quality.fingerprint, quality.fingerprint) / (dt / 1000) : null;
  const brightnessChangePerSecond = measurable ? Math.abs(previous!.quality.brightness - quality.brightness) / (dt / 1000) : null;
  const drift = previous?.anchor ? duplicateDistance(previous.anchor, quality.fingerprint) : 0;
  let reason = quality.issues[0] || '';
  if (!reason && (brightnessChangePerSecond ?? 0) > limits.maxBrightnessChangePerSecond) reason = '밝기가 변하고 있어요. 조명을 일정하게 유지하고 잠깐 기다려주세요.';
  if (!reason && changePerSecond === null) reason = '움직임을 확인하고 있어요. 잠깐 멈춰주세요.';
  if (!reason && changePerSecond! > limits.fastChangePerSecond) reason = '움직임이 커요. 더 천천히 돌린 뒤 멈춰주세요.';
  // An anchor prevents a slow continuous turn from passing a relaxed frame-to-frame threshold.
  if (!reason && drift > limits.maxHoldDrift) reason = '제품 방향이 바뀌었어요. 그 위치에서 잠깐 멈춰주세요.';
  const moderate = !reason && changePerSecond! > limits.stillChangePerSecond;
  const unsettledMs = moderate ? (previous?.unsettledMs ?? 0) + dt : 0;
  if (moderate && unsettledMs > limits.motionGraceMs) reason = '움직임이 이어지고 있어요. 제품과 휴대폰을 잠깐 멈춰주세요.';
  const reset = Boolean(reason);
  const paused = moderate && !reset;
  // Brief moderate shake pauses the clock; ordinary hand tremor advances it.
  const heldMs = reset ? 0 : paused ? previous?.heldMs ?? 0 : previous?.anchor ? (previous.heldMs + dt) : 0;
  const anchor = reset ? null : previous?.anchor ?? quality.fingerprint;
  const ready = !reset && !paused && heldMs >= limits.holdMs;
  const state: MotionState = { at, quality, heldMs, anchor, unsettledMs, epoch: (previous?.epoch ?? 0) + (reset || paused ? 1 : 0) };
  return { state, ready, heldMs, changePerSecond, brightnessChangePerSecond, reason: reason || (paused ? '잠깐 흔들렸어요. 카운트는 유지한 채 기다릴게요.' : ready ? '품질 확인됨' : `편하게 유지해주세요. ${(heldMs / 1000).toFixed(1)} / 2.0초`) };
}
