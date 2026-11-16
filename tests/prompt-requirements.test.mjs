import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchema, inputError, MAX_REQUEST_LENGTH, MAX_SHOTS } from '../lib/prompt-engine/schema.ts';
import { validateRequirements, applyRequirementAudit, assertRequirementsRetained, PlanValidationError } from '../lib/prompt-engine/requirements.ts';
import { compilePrompts, makePackage } from '../lib/prompt-engine/engine.ts';
import { restoreWorkspace, emptyWorkspace } from '../lib/prompt-engine/workspace.ts';
import { withRecovery, generationError } from '../lib/prompt-engine/recovery.ts';
import { APICallError } from 'ai';
const brief = {request:'열린 캡의 얼룩을 제거하고 글씨 크게 보여줘',count:1,ratio:'1:1',images:[{id:'open',name:'열린 병',role:'product',data:'data:image/jpeg;base64,/9j/AA=='}]};
const requirements=[{id:'clean',quote:'얼룩을 제거',origin:'request',text:'열린 캡의 얼룩을 제거한다.',field:'action',targetShots:[],sourceIds:['open']},{id:'copy',quote:'글씨 크게',origin:'request',text:'제품명을 큰 글씨로 표시한다.',field:'copy',targetShots:[],sourceIds:[]}];
const shot={id:'s1',title:'제품',sourceIds:['open'],purpose:'제품',background:'흰색',composition:'중앙',lighting:'확산광',props:'없음',action:'없음',copy:'없음'};
const proposal={productName:'예시',observation:'병',identity:[{text:'병',sourceIds:['open']}],unknowns:[],references:[],questions:[],requirements,directions:[{id:'a',title:'정면',summary:'제품',reason:'제품',palette:['#ffffff','#eeeeee','#dddddd'],shots:[shot]}]};
const edits=requirements.map((r,groupIndex)=>({groupIndex,value:r.text}));
test('requirements are grounded in verbatim user/answer text and valid product evidence',()=>{
 assert.doesNotThrow(()=>validateRequirements(brief,[],requirements));
 assert.throws(()=>validateRequirements(brief,[],[{...requirements[0],quote:'사용자가 하지 않은 요청'}]),PlanValidationError);
 assert.throws(()=>validateRequirements(brief,[],[{...requirements[0],sourceIds:['invented']}]),PlanValidationError);
 assert.throws(()=>validateRequirements(brief,[],[{...requirements[0],targetShots:[2]}]),PlanValidationError);
 assert.doesNotThrow(()=>validateRequirements(brief,[{question:'박스?',answer:'박스 없이 단품으로'}],[{...requirements[0],origin:'answer',quote:'박스 없이',text:'박스 제외',sourceIds:[]}]));
});
test('audit repairs omitted action/copy and export retains requirements; incomplete audits cannot pass',()=>{
 assert.throws(()=>assertRequirementsRetained(proposal));
 assert.throws(()=>applyRequirementAudit(brief,proposal,{edits:edits.slice(0,1)}));
 assert.throws(()=>applyRequirementAudit(brief,proposal,{edits:[...edits,edits[0]]}));
 assert.throws(()=>applyRequirementAudit(brief,proposal,{edits:[{...edits[0],value:'없음'},edits[1]]}));
 const fixed=applyRequirementAudit(brief,proposal,{edits});
 assert.equal(fixed.directions[0].shots[0].action,requirements[0].text);
 assert.equal(fixed.directions[0].shots[0].copy,requirements[1].text);
 assert.equal(shot.action,'없음');
 const plan={direction:fixed.directions[0],revision:1,history:[]};
 const prompt=compilePrompts(brief,fixed,plan)[0].prompt;
 for(const r of requirements)assert.ok(prompt.includes('고객 필수 요청: '+r.text));
 assert.equal(makePackage(brief,fixed,plan,new Date().toISOString()).prompts.length,1);
 assert.throws(()=>makePackage(brief,proposal,{...plan,direction:proposal.directions[0]},new Date().toISOString()));
});
test('numbered requirements apply to their own shots without contaminating other cuts',()=>{
 const scoped={...proposal,requirements:[{...requirements[0],targetShots:[2]}],directions:[{...proposal.directions[0],shots:[shot,{...shot,id:'s2',action:requirements[0].text}]}]};
 assert.doesNotThrow(()=>assertRequirementsRetained(scoped));
 const prompts=compilePrompts({...brief,count:2},scoped,{direction:scoped.directions[0],revision:1,history:[]});
 assert.ok(!prompts[0].prompt.includes('고객 필수 요청:'));
 assert.ok(prompts[1].prompt.includes('고객 필수 요청:'));
});
test('long original text and nine/twelve shots survive validation and persistence with useful boundary errors',()=>{
 const long={...brief,request:'가'.repeat(MAX_REQUEST_LENGTH),count:MAX_SHOTS};
 assert.equal(briefSchema.safeParse(long).success,true);
 assert.deepEqual(restoreWorkspace({...emptyWorkspace,brief:long}).brief,long);
 const tooLong=briefSchema.safeParse({...long,request:long.request+'가'});
 assert.match(inputError(tooLong.error),/12,000/);
 const tooMany=briefSchema.safeParse({...long,count:MAX_SHOTS+1});
 assert.match(inputError(tooMany.error),/12장/);
 assert.equal(briefSchema.safeParse({...brief,count:9}).success,true);
});
const providerError=statusCode=>new APICallError({message:'PRIVATE_PAYLOAD',url:'https://api.example',requestBodyValues:{secret:'PRIVATE'},statusCode});
test('one bounded retry recovers transient or validation failures, never retries permanent/abort failures',async()=>{
 let calls=0;const attempts=[];
 assert.equal(await withRecovery('planning',async repair=>{calls++;if(!repair)throw providerError(503);return 'ok';},new AbortController().signal,attempts,0),'ok');
 assert.equal(calls,2);assert.deepEqual(attempts.map(a=>a.status),['provider_transient','ok']);
 calls=0;await assert.rejects(withRecovery('planning',async()=>{calls++;throw providerError(401);},new AbortController().signal,[],0));assert.equal(calls,1);
 calls=0;await assert.rejects(withRecovery('planning',async()=>{calls++;throw new PlanValidationError('missing');},new AbortController().signal,[],0));assert.equal(calls,2);
 calls=0;await assert.rejects(withRecovery('planning',async()=>{calls++;return 'bad';},AbortSignal.abort(),[],0));assert.equal(calls,0);
 assert.equal(generationError(new DOMException('time','TimeoutError')).status,504);
 assert.equal(generationError(providerError(429)).code,'provider_busy');
 assert.ok(!JSON.stringify(generationError(providerError(401))).includes('PRIVATE'));
});

test('questions are only opened for missing product evidence and preserve requested shot count', async()=>{
 const { questionsForRequirements, requirementSources, extractionSchema }=await import('../lib/prompt-engine/requirements.ts');
 assert.deepEqual(questionsForRequirements(brief,requirements),[]);
 const missing=[{...requirements[0],evidence:'missing',sourceIds:[]},{...requirements[1],evidence:'missing',sourceIds:[]}];
 const q=questionsForRequirements({...brief,count:9},missing);
 assert.equal(q.length,1);assert.match(q[0].options[1],/9장/);assert.ok(q[0].options.every(x=>!x.includes('생략')));
 const sources=requirementSources(brief,[{question:'패키지?',answer:'박스 제외'}]);
 const schema=extractionSchema(sources);
 const value={requirements:[{...requirements[0],sourceKey:sources[0].key,evidence:'visible'}]};
 const parsed=schema.parse(value);assert.equal(parsed.requirements[0].quote,undefined);
 assert.equal(schema.safeParse({requirements:[{...value.requirements[0],sourceKey:'unknown'}]}).success,false);
 assert.equal(sources[0].text,brief.request);
});

test('evidence review cannot omit, duplicate, or invent evidence, and preserves every original requirement',async()=>{
 const {applyEvidenceReview,evidenceReviewSchema}=await import('../lib/prompt-engine/requirements.ts');
 const reqs=[{...requirements[0],evidence:'missing',sourceIds:[]},{...requirements[1],evidence:'not_needed'}];
 const reviewed=applyEvidenceReview(brief,[],reqs,{decisions:[{id:'clean',evidence:'visible',sourceIds:['open']},{id:'copy',evidence:'not_needed',sourceIds:[]}]});
 assert.equal(reviewed[0].text,reqs[0].text);assert.equal(reviewed[0].quote,reqs[0].quote);
 assert.equal(reviewed[0].evidence,'visible');assert.deepEqual(reviewed[1],reqs[1]);
 assert.throws(()=>applyEvidenceReview(brief,[],reqs,{decisions:[]}));
 assert.throws(()=>applyEvidenceReview(brief,[],reqs,{decisions:[{id:'wrong',evidence:'not_needed',sourceIds:[]}]}));
 assert.throws(()=>applyEvidenceReview(brief,[],reqs,{decisions:[{id:'clean',evidence:'visible',sourceIds:['invented']}]}));
 assert.throws(()=>applyEvidenceReview(brief,[],reqs,{decisions:[{id:'clean',evidence:'visible',sourceIds:[]}]}));
 const schema=evidenceReviewSchema(brief,[reqs[0]]);
 assert.equal(schema.safeParse({decisions:[{id:'clean',evidence:'missing',sourceIds:['invented'],reason:'invalid'}]}).success,false);
});

test('generic model shot types and explicit product-only box omission cannot trigger photo questions',async()=>{
 const {normalizeCreativeEvidence,questionsForRequirements,extractionSchema,requirementSources}=await import('../lib/prompt-engine/requirements.ts');
 const model={...requirements[0],text:'모델 전신컷으로 제작',field:'purpose',sourceIds:[],evidence:'missing'};
 const generic={...brief,request:'모델 부분컷 썸네일 × 1장\n모델 전신컷 썸네일 × 1장'};
 assert.deepEqual(questionsForRequirements(generic,normalizeCreativeEvidence(generic,[],[model])),[]);
 for(const text of ['7번은 모델 전신컷으로 구성','3번 샷은 모델 부분컷으로 구성','자연광의 모델 전신컷으로 제작']) assert.equal(normalizeCreativeEvidence(generic,[],[{...model,text}])[0].evidence,'not_needed');
 assert.equal(normalizeCreativeEvidence(generic,[],[{...model,text:'모델 전신컷에 실제 패키지 포함'}])[0].evidence,'missing');
 assert.equal(normalizeCreativeEvidence({...generic,request:'첨부 사진의 특정 모델과 동일 인물로'},[],[model])[0].evidence,'missing');
 const box={...model,text:'박스 없이 제품만 보이는 대체 컷으로 제작'};
 assert.equal(normalizeCreativeEvidence(brief,[{question:'박스?',answer:box.text}],[box])[0].evidence,'not_needed');
 assert.equal(normalizeCreativeEvidence(brief,[],[{...model,text:'패키지 포함 제품컷'}])[0].evidence,'missing');
 assert.equal(normalizeCreativeEvidence(brief,[],[{...model,text:'1번은 화이트 목업 제품 썸네일로 구성'}])[0].evidence,'not_needed');
 assert.equal(normalizeCreativeEvidence(brief,[],[{...model,text:'화이트 배경의 제품 뒷면 사진으로 제작'}])[0].evidence,'missing');
 assert.equal(normalizeCreativeEvidence(brief,[],[{...model,text:'화이트 목업 제품 사진 패키지 포함'}])[0].evidence,'missing');
 const schema=extractionSchema(requirementSources(brief,[]),brief);
 assert.equal(schema.safeParse({requirements:[{...model,sourceKey:'source-0-0',sourceIds:['invented']}]}).success,false);
});

test('an added headline needs no photo while specific logo and label artwork still need evidence',async()=>{
 const {normalizeCreativeEvidence,applyEvidenceReview,questionsForRequirements}=await import('../lib/prompt-engine/requirements.ts');
 const request='제품명 LUMI를 큰 글씨로 상단에 넣어주세요.';
 const input={...brief,request};
 const headline={...requirements[0],id:'headline',text:'상단에 LUMI를 큰 글씨로 넣기',quote:request,origin:'request',field:'copy',sourceIds:[],evidence:'missing',targetShots:[]};
 const extraction=normalizeCreativeEvidence(input,[],[headline]);
 assert.equal(extraction[0].evidence,'not_needed');
 const reviewed=applyEvidenceReview(input,[],extraction,{decisions:[{id:'headline',evidence:'missing',sourceIds:[]}]});
 assert.equal(reviewed[0].text,headline.text);
 assert.deepEqual(questionsForRequirements(input,reviewed),[]);
 for(const text of ['사진 속 로고와 동일한 제목 넣기','뒷면 라벨 문구를 그대로 넣기','패키지 인증마크를 제목 옆에 넣기']) {
  const preserved=normalizeCreativeEvidence(input,[],[{...headline,text}]);
  assert.equal(preserved[0].evidence,'missing');
  assert.equal(questionsForRequirements(input,preserved).length,1);
 }
});
