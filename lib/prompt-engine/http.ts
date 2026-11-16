
export function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function checkAccess(request: Request) {
  const origin = request.headers.get('origin');
  // Next's local Request URL may use localhost even when the visible host is 127.0.0.1.
  const url = new URL(request.url);
  const expectedOrigin = `${url.protocol}//${request.headers.get('host') || url.host}`;
  if (origin && origin !== expectedOrigin) return fail('연출 기획 화면에서 다시 요청해주세요.', 403);
  return null;
}
export async function readBody(request: Request) {
  const limit = 4_000_000;
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError('사진 용량이 너무 커요. 사진을 줄여 다시 시도해주세요.');
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    bytes += part.value.length;
    if (bytes > limit) { await reader.cancel(); throw new RangeError('사진 용량이 너무 커요. 사진을 줄여 다시 시도해주세요.'); }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(request: Request) {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const bucket = buckets.get(key) || { count: 0, until: now + 60_000 };
  if (bucket.count >= 12 || buckets.size >= 2000) return fail('요청이 많아요. 1분 뒤 다시 시도해주세요.', 429);
  bucket.count++; buckets.set(key, bucket); return null;
}
