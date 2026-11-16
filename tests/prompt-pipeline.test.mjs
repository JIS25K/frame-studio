import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){return specifier.startsWith('@/lib/prompt-engine/')?next(new URL('../lib/prompt-engine/'+specifier.split('/').at(-1)+'.ts',import.meta.url).href,context):next(specifier,context);}});
const {POST}=await import('../app/api/prompt/plan/route.ts');
const requirement={id:'r1',quote:'글씨 크게',origin:'request',text:'제품명을 큰 글씨로 표시한다.',field:'copy',evidence:'not_needed',targetShots:[],sourceIds:[]};
const image={id:'product',name:'제품',role:'product',data:'data:image/jpeg;base64,/9j/AA=='};
const shot={id:'s1',title:'정면',sourceIds:['product'],purpose:'제품',background:'흰색',composition:'정면',lighting:'좌측',props:'없음',action:'정지',copy:'없음'};
const direction={id:'a',title:'정면',summary:'깨끗하게',reason:'제품 강조',palette:['#FFFFFF','#EEEEEE','#CCCCCC'],shots:[shot]};
const proposal={productName:'제품',observation:'병',identity:[{text:'초록 병',sourceIds:['product']}],unknowns:[],references:[],questions:[],directions:[direction,{...direction,id:'b'}]};
const response=output=>Response.json({id:'resp_test',object:'response',created_at:1,model:'gpt-5.4-mini',status:'completed',output:[{type:'message',id:'msg_test',status:'completed',role:'assistant',content:[{type:'output_text',text:typeof output==='string'?output:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
test('real SDK pipeline recovers malformed output, audits every direction and preserves zero questions',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;let calls=0;process.env.OPENAI_API_KEY='test-key';
 globalThis.fetch=async(url,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.store,false);
 if(calls===1)return response({requirements:[{...requirement,sourceKey:'source-0-0'}]});
 if(calls===2)return response({decisions:[{id:requirement.id,evidence:'not_needed',sourceIds:[],reason:'글자 크기는 연출 조건'}]});
 if(calls===3)return response('broken-json');
 if(calls===4)return response(proposal);
 return response({edits:proposal.directions.map((d,groupIndex)=>({groupIndex,value:requirement.text}))});};
 try{
 const result=await POST(new Request('http://localhost/api/prompt/plan',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'propose',brief:{request:'글씨 크게 보여줘',count:1,ratio:'1:1',images:[image]},answers:[]})}));
 assert.equal(result.status,200);const body=await result.json();assert.equal(calls,5);
 assert.equal(body.proposal.questions.length,0);assert.equal(body.proposal.requirements.length,1);
 assert.ok(body.proposal.directions.every(d=>d.shots[0].copy.includes(requirement.text)));
 assert.deepEqual(body.diagnostics.attempts.map(a=>a.status),['ok','ok','structured_output','ok','ok']);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

test('suspect evidence is reviewed before questions: generic model and excluded box do not block a plan',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;let calls=0;process.env.OPENAI_API_KEY='test-key';
 const req={id:'model',sourceKey:'source-0-0',text:'모델 전신컷으로 제작한다.',field:'purpose',targetShots:[1],sourceIds:[],evidence:'missing'};
 globalThis.fetch=async(url,options)=>{calls++;const payload=JSON.parse(options.body);
 if(calls===1)return response({requirements:[req,{...req,id:'omit',sourceKey:'source-1-0',text:'박스 없이 제품만 보이게 한다.',field:'composition'}]});
 if(calls===2)return response({decisions:[{id:'model',evidence:'not_needed',sourceIds:[],reason:'일반 모델 연출'},{id:'omit',evidence:'visible',sourceIds:['product'],reason:'박스는 제외했고 제품은 보임'}]});
 if(calls===3){assert.ok(JSON.stringify(payload.input).includes('questions'));return response(proposal);}
 return response({edits:[{groupIndex:0,value:req.text},{groupIndex:1,value:'박스 없이 제품만 보이게 한다.'},{groupIndex:2,value:req.text},{groupIndex:3,value:'박스 없이 제품만 보이게 한다.'}]});};
 try{
 const result=await POST(new Request('http://localhost/api/prompt/plan',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({action:'propose',brief:{request:'모델 전신컷',count:1,ratio:'1:1',images:[image]},answers:[{question:'박스?',answer:'박스 없이 제품만 보이게 한다.'}]})}));
 const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));assert.equal(calls,4);
 assert.deepEqual(body.proposal.questions,[]);assert.equal(body.diagnostics.attempts[1].stage,'evidence_review');
 assert.ok(body.proposal.directions.every(d=>d.shots[0].purpose.includes(req.text)&&d.shots[0].composition.includes('박스 없이')));
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
