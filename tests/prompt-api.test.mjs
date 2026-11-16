import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { return specifier.startsWith('@/lib/prompt-engine/') ? next(new URL('../lib/prompt-engine/' + specifier.split('/').at(-1) + '.ts', import.meta.url).href, context) : next(specifier, context); } });
const { POST } = await import('../app/api/prompt/plan/route.ts');
const { GET } = await import('../app/api/prompt/status/route.ts');
const image = { id: 'front', role: 'product', name: '제품', data: 'data:image/jpeg;base64,/9j/AA==' };
const brief = { request: '하얀 배경 광고', images: [image], count: 1, ratio: '1:1' };
const shot = { id: 's1', title: '정면', sourceIds: ['front'], purpose: '제품', background: '흰색', composition: '정면', lighting: '좌측', props: '없음', action: '정지', copy: '없음' };
const proposal = { productName: '제품', observation: '병', identity: [{ text: '초록 병', sourceIds: ['front'] }], unknowns: [], references: [], questions: [], directions: [{ id: 'a', title: '정면', summary: '깨끗하게', reason: '제품 강조', palette: ['#FFFFFF', '#EEEEEE', '#CCCCCC'], shots: [shot] }] };
proposal.directions.push({ ...proposal.directions[0], id: 'b', title: '여백 강조' });
const request = (body, headers = {}) => new Request('http://localhost/api/prompt/plan', { method: 'POST', headers: { origin: 'http://localhost', 'x-prompt-code': 'testing', ...headers }, body: JSON.stringify(body) });
test('API checks auth and size; real SDK request carries original images; patch returns only changed fields', async () => {
  const before = { key: process.env.OPENAI_API_KEY, code: process.env.PROMPT_ACCESS_CODE, capture: process.env.CAPTURE_ACCESS_CODE, vercel: process.env.VERCEL };
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false); assert.equal(payload.text.format.type, 'json_schema');
    assert.ok(JSON.stringify(payload.input).includes(image.data));
    const output = calls === 1 ? proposal : { message: '배경만 수정', unresolved: [], edits: [{ shotId: 's1', field: 'background', value: '연파랑' }] };
    return Response.json({ id: 'resp_test', object: 'response', created_at: 1, model: 'gpt-5.4-mini', status: 'completed', output: [{ type: 'message', id: 'msg_test', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
  };
  try {
    delete process.env.VERCEL; delete process.env.OPENAI_API_KEY; process.env.PROMPT_ACCESS_CODE = 'testing';
    const data = { action: 'propose', brief, answers: [] };
    assert.equal((await POST(request(data))).status, 503);
    process.env.OPENAI_API_KEY = 'test-key';
    assert.equal((await POST(request(data, { 'x-prompt-code': 'wrong' }))).status, 401);
    assert.equal((await POST(request(data, { origin: 'https://elsewhere.test' }))).status, 403);
    assert.equal((await POST(request(data, { 'content-length': '5000001' }))).status, 413);
    assert.equal((await POST(request({ ...data, brief: { ...brief, images: [] } }))).status, 400);
    assert.equal(calls, 0);
    assert.deepEqual((await (await POST(request(data))).json()).proposal, proposal);
    const plan = { direction: proposal.directions[0], revision: 1, history: [] };
    const response = await POST(request({ action: 'revise', brief, proposal, plan, request: '배경만 연파랑' }));
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.plan.revision, 2);
    assert.deepEqual(result.plan.direction.shots[0], { ...shot, background: '연파랑' });
    assert.equal(calls, 2);
    process.env.VERCEL = '1'; delete process.env.PROMPT_ACCESS_CODE; delete process.env.CAPTURE_ACCESS_CODE;
    assert.equal((await (await GET()).json()).configured, false);
    assert.equal((await POST(request(data))).status, 503);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: before.key, PROMPT_ACCESS_CODE: before.code, CAPTURE_ACCESS_CODE: before.capture, VERCEL: before.vercel })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
