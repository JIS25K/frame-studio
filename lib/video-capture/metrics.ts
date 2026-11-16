// Dense per-frame quality/change plus conservative adjacent-frame patch correspondence.
// These are 2D image tracks, not segmentation, object pose, or proof of physical identity.
export type Point = { id: number; x: number; y: number; age: number };
export function grayPixels(rgba: Uint8ClampedArray) {
  const g = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < g.length; i++)
    g[i] = Math.round(
      0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2],
    );
  return g;
}
export function measure(
  g: Uint8Array,
  previous: Uint8Array | null,
  w: number,
  h: number,
) {
  let sum = 0,
    lap = 0,
    diff = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      sum += g[i];
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      lap += l * l;
      if (previous) diff += Math.abs(g[i] - previous[i]);
    }
  const n = (w - 2) * (h - 2);
  return {
    sharpness: lap / n,
    brightness: sum / n,
    change: previous ? diff / n / 255 : 0,
  };
}
export function seedPoints(
  g: Uint8Array,
  w: number,
  h: number,
  nextId: number,
): Point[] {
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 8; y < h - 8; y += 5)
    for (let x = 8; x < w - 8; x += 5) {
      const i = y * w + x;
      const gx = Math.abs(g[i - 1] - g[i + 1]),
        gy = Math.abs(g[i - w] - g[i + w]);
      const score = Math.min(gx, gy);
      if (score > 10) candidates.push({ x, y, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  const points: Point[] = [];
  for (const p of candidates) {
    if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 9))
      points.push({ id: nextId++, x: p.x, y: p.y, age: 1 });
    if (points.length >= 24) break;
  }
  return points;
}
function cost(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
) {
  let v = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      v += Math.abs(a[(y + dy) * w + x + dx] - b[(ny + dy) * w + nx + dx]);
  return v / 25;
}
export function trackPoints(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  points: Point[],
): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (p.x < 7 || p.y < 7 || p.x >= w - 7 || p.y >= h - 7) continue;
    let best = Infinity,
      second = Infinity,
      bx = p.x,
      by = p.y;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const c = cost(a, b, w, p.x, p.y, p.x + dx, p.y + dy);
        if (c < best) {
          second = best;
          best = c;
          bx = p.x + dx;
          by = p.y + dy;
        } else second = Math.min(second, c);
      }
    if (best > 18 || second - best < 0.6) continue;
    let back = Infinity,
      rx = bx,
      ry = by;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        if (bx + dx < 3 || by + dy < 3 || bx + dx >= w - 3 || by + dy >= h - 3)
          continue;
        const c = cost(b, a, w, bx, by, bx + dx, by + dy);
        if (c < back) {
          back = c;
          rx = bx + dx;
          ry = by + dy;
        }
      }
    if (Math.hypot(rx - p.x, ry - p.y) <= 1.5)
      out.push({ id: p.id, x: bx, y: by, age: p.age + 1 });
  }
  return out;
}
