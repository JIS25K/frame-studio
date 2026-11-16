import test from 'node:test';
import assert from 'node:assert/strict';
import { applySupplementObservation, deferSupplement, excludeSupplementEvidence, localBlur, nextSupplement, openSupplement } from '../lib/capture/supplement.ts';
const quality={sharpness:100,brightness:120,dark:0,light:0,fingerprint:[],issues:[]};
const frame=(at,image=`frame-${at}`)=>({at,image,quality});
const o=(issue='none',check='same_region_clear')=>({usable:true,sameProduct:'yes',addsInformation:true,shape:'flat',description:'상자',newDetails:['라벨'],visibleGaps:[],action:'rotate',guidance:'돌려주세요',inspection:{issue,region:'라벨',evidence:'주변 테두리가 같고 글자가 선명하게 보임',targetCheck:check}});
const task=(kind='blurred')=>openSupplement([],kind,frame(0),'라벨','글자가 흐림','model');
test('a different clear side, an absent gap, or uncertain identity cannot resolve a blurry region',()=>{
 for(const check of ['different_region','uncertain','not_requested','still_blocked'])assert.equal(applySupplementObservation(task(),frame(4000),o('none',check),'supplement-1',true).tasks[0].status,'open');
 assert.equal(applySupplementObservation(task(),frame(4000),{...o(),inspection:undefined},'supplement-1',true).tasks[0].status,'open');
 assert.equal(applySupplementObservation(task(),frame(4000),{...o(),sameProduct:'uncertain'},'supplement-1',true).tasks[0].status,'open');
});
test('same-region clear evidence resolves an occlusion and exclusion reopens it',()=>{
 const result=applySupplementObservation(task('occluded'),frame(4000),o(),'supplement-1',true);
 assert.equal(result.improvedId,'supplement-1');assert.equal(result.tasks[0].support.at,4000);
 assert.equal(excludeSupplementEvidence(result.tasks,4000)[0].status,'open');
 assert.equal(excludeSupplementEvidence(result.tasks,4000)[0].support,null);
});
test('repeat requires a genuinely new view; another duplicate does not resolve it',()=>{
 assert.equal(applySupplementObservation(task('repeated'),frame(4000),o(),'supplement-1',true).improvedId,null);
 assert.equal(applySupplementObservation(task('repeated'),frame(4000),o('none','new_view'),'supplement-1',true).improvedId,'supplement-1');
 assert.equal(applySupplementObservation(task('repeated'),frame(4000),{...o('none','new_view'),addsInformation:false},'supplement-1',true).improvedId,null);
});
test('local quality rejection, identical bytes and wrong target cannot resolve a task',()=>{
 assert.equal(applySupplementObservation(task(),frame(4000),o(),'supplement-1',false).improvedId,null);
 assert.equal(applySupplementObservation(task(),frame(4000,'frame-0'),o(),'supplement-1',true).improvedId,null);
 assert.equal(applySupplementObservation(task(),frame(4000),o(),'supplement-9',true).improvedId,null);
});
test('deferred target stays unresolved after an in-flight response and does not block next target',()=>{
 let tasks=openSupplement(task(),'occluded',frame(1000),'바닥','손에 가림','model');
 tasks=deferSupplement(tasks,'supplement-1',2000);
 assert.equal(nextSupplement(tasks).id,'supplement-2');
 assert.equal(applySupplementObservation(tasks,frame(4000),o(),'supplement-1',true).tasks[0].status,'deferred');
});
test('grounded issue types are stored separately; no-novelty alone does not imply repeated side',()=>{
 assert.equal(applySupplementObservation([] ,frame(0),{...o(),addsInformation:false},null,true).tasks.length,0);
 for(const kind of ['repeated','blurred','occluded']){
  const observation={...o(kind,'not_requested'),addsInformation:false};
  const tasks=applySupplementObservation([],frame(0),observation,null,true).tasks;
  assert.equal(tasks[0].kind,kind);assert.equal(tasks[0].anchor.at,0);
 }
 assert.equal(applySupplementObservation([],frame(0),{...o('occluded'),sameProduct:'uncertain'},null,true).tasks.length,0);
});
test('local low sharpness does not mislabel exposure and keeps the original unresolved anchor',()=>{
 assert.equal(localBlur({...quality,sharpness:10}),true);
 assert.equal(localBlur({...quality,sharpness:10,brightness:20}),false);
 assert.equal(localBlur({...quality,sharpness:10,light:.6}),false);
 let tasks=openSupplement([],'blurred',frame(0),'위치 미확인','경계 부족','local-quality');
 tasks=openSupplement(tasks,'blurred',frame(2000),'위치 미확인','경계 부족','local-quality');
 assert.equal(tasks.length,1);assert.equal(tasks[0].anchor.at,0);
});
