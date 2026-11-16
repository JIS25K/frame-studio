import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return s==='@/lib/capture/observation'?next(new URL('../lib/capture/observation.ts',import.meta.url).href,c):s==='./quality'?next(new URL('../lib/capture/quality.ts',import.meta.url).href,c):next(s,c);}});
const { POST }=await import('../app/api/capture/observe/route.ts');
const request=(body,code='')=>new Request('http://localhost/api/capture/observe',{method:'POST',headers:{origin:'http://localhost','x-capture-code':code},body:JSON.stringify(body)});
test('continuous observation endpoint validates access and references, uses structured output without retention',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY,oldCode=process.env.CAPTURE_ACCESS_CODE;let calls=0;
 const frame='data:image/jpeg;base64,/9j/AA==';
 const observation={usable:true,sameProduct:'no_reference',addsInformation:true,shape:'flat',description:'넓은 표면',newDetails:['외곽'],visibleGaps:[],action:'rotate',guidance:'천천히 돌려주세요.',inspection:{box:null,issue:'none',region:'',evidence:'',targetCheck:'not_requested'}};
 try{
  process.env.OPENAI_API_KEY='fake-test-key';process.env.CAPTURE_ACCESS_CODE='test';
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.text.format.type,'json_schema');assert.ok(JSON.stringify(payload.input).includes('CURRENT frame'));if(calls===2){assert.ok(JSON.stringify(payload.input).includes('SELECTED frame 1'));assert.ok(JSON.stringify(payload.input).includes('BASELINE FRONT'));assert.ok(JSON.stringify(payload.input).includes('Direction: left'));}if(calls===3){assert.ok(JSON.stringify(payload.input).includes('TARGET to recheck'));assert.ok(JSON.stringify(payload.input).includes('supplement-1'));}
   return Response.json({id:'r_test',object:'response',created_at:1,model:'gpt-5.4-mini',status:'completed',output:[{type:'message',id:'m',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(observation),annotations:[]}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});};
  assert.equal((await POST(request({frame:'https://invalid.example/a.jpg',references:[]}))).status,400);
  assert.equal((await POST(request({frame,references:Array(5).fill({frame,description:'x'})}))).status,400);assert.equal(calls,0);
  assert.equal((await POST(request({frame,references:[],baseline:{frame,direction:'clockwise',stage:'rotate'}}))).status,400);
  const r=await POST(request({frame,references:[]}));assert.equal(r.status,200);assert.equal((await r.json()).observation.shape,'flat');
  assert.equal((await POST(request({frame,references:[{frame,description:'start'}],baseline:{frame,direction:'left',stage:'rotate'}}))).status,200);assert.equal(calls,2);
  assert.equal((await POST(request({frame,references:[],target:{id:'bad',kind:'occluded',region:'라벨',reason:'손',frame}}))).status,400);
  assert.equal((await POST(request({frame,references:[],target:{id:'supplement-1',kind:'occluded',region:'라벨',reason:'손',frame}}))).status,200);assert.equal(calls,3);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldCode===undefined)delete process.env.CAPTURE_ACCESS_CODE;else process.env.CAPTURE_ACCESS_CODE=oldCode;}
});
