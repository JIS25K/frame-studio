import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return s.startsWith('@/')?next(new URL('../'+s.slice(2)+'.ts',import.meta.url).href,c):next(s,c);}});
const {POST}=await import('../app/api/capture/video/route.ts');
const image='data:image/jpeg;base64,/9j/AA==';
const input={action:'window',sheet:image,frames:[100,101],times:[3,3.033],overview:[{frame:101,time:3.033,image}],baseline:image,known:[],targets:[]};
const req=(body,origin='http://localhost')=>new Request('http://localhost/api/capture/video',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('whole-video API preserves current/historical distinction, rejects invalid source frames and prevents retained requests',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;let output={productVisible:true,sameProduct:'yes',summary:'열린 제품',observations:[{key:'interior',label:'내부',state:'open',frame:101,box:{x:.2,y:.2,width:.5,height:.5},quality:'clear',description:'내부가 보임'}],gaps:[]};let calls=0;
 try{delete process.env.OPENAI_API_KEY;assert.equal((await POST(req(input))).status,503);process.env.OPENAI_API_KEY='test';
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');const p=JSON.parse(options.body);assert.equal(p.store,false);const wire=JSON.stringify(p.input);assert.ok(wire.includes('HISTORICAL'));assert.ok(wire.includes('CURRENT SOURCE'));return Response.json({id:'r',object:'response',created_at:1,model:'gpt-5.4-mini',status:'completed',output:[{type:'message',id:'m',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:10,output_tokens:10,total_tokens:20,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});};
 assert.equal((await POST(req(input,'https://unrelated.example'))).status,403);assert.equal(calls,0);
 assert.equal((await POST(req({...input,overview:[{frame:999,time:1,image}]}))).status,400);assert.equal(calls,0);
 assert.equal((await POST(req(input))).status,200);
 output={...output,observations:output.observations.map(o=>({...o,frame:99}))};assert.equal((await POST(req(input))).status,502);
 output={...output,observations:output.observations.map(o=>({...o,frame:101,box:{x:.8,y:0,width:.5,height:.5}}))};assert.equal((await POST(req(input))).status,502);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
