import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { return specifier === '@/lib/capture/spec' ? next(new URL('../lib/capture/spec.ts', import.meta.url).href, context) : next(specifier, context); } });
const { POST } = await import('../app/api/capture/analyze/route.ts');
const { exampleSpecs, sixViewSpec } = await import('../lib/capture/spec.ts');
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY, originalCode = process.env.CAPTURE_ACCESS_CODE;
const input = { spec: exampleSpecs[0], targetId: 'front', frame: 'data:image/jpeg;base64,/9j/AA==', reference: null };
const request = (body, code = '') => new Request('http://localhost/api/capture/analyze', { method: 'POST', headers: { origin: 'http://localhost', 'x-capture-code': code }, body: JSON.stringify(body) });
test('capture API enforces access, validates input and sends only target/reference evidence', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.ok(JSON.stringify(payload.input).includes('CURRENT image to evaluate'));
    assert.equal(payload.text.format.type, 'json_schema');
    if (calls === 2) {
      const inputText=JSON.stringify(payload.input);
      for (const id of ['right','back','left','top']) assert.ok(inputText.includes('PREVIOUS accepted view '+id));
      assert.ok(inputText.includes('REFERENCE FRONT'));
    }
    const verdict = { observedView: 'front', sameProduct: 'no_reference', framingMatches: true, matchesTarget: true, confidence: .91, visibleParts: ['상자 앞면'], missingParts: [], evidence: '상자 앞면 전체가 보임', guidance: '잠시 멈춰주세요.' };
    return new Response(JSON.stringify({ id: 'resp_test', object: 'response', created_at: 1, model: 'gpt-5.4-mini', status: 'completed', output: [{ type: 'message', id: 'msg_test', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(verdict), annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal((await POST(request(input))).status, 503);
    process.env.OPENAI_API_KEY = 'not-a-real-key'; process.env.CAPTURE_ACCESS_CODE = 'local-test-access';
    assert.equal((await POST(request({ ...input, frame: 'https://external.invalid/photo.jpg' }))).status, 400);
    assert.equal((await POST(request({ ...input, targetId: 'side' }))).status, 400);
    assert.equal((await POST(request({ ...input, context: [{ targetId: 'front', frame: input.frame }] }))).status, 400);
    assert.equal(calls, 0);
    const response = await POST(request(input));
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.verdict.observedView, 'front'); assert.equal(result.usage.inputTokens, 100); assert.equal(calls, 1);
    const sixResponse = await POST(request({ ...input, spec: sixViewSpec, targetId: 'bottom', reference: input.frame, context: ['right','back','left','top'].map(targetId => ({ targetId, frame: input.frame })) }));
    assert.equal(sixResponse.status,200); assert.equal(calls,2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalCode === undefined) delete process.env.CAPTURE_ACCESS_CODE; else process.env.CAPTURE_ACCESS_CODE = originalCode;
  }
});
