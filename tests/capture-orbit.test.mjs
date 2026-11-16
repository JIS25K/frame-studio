import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return s==='./quality'?next(new URL('../lib/capture/quality.ts',import.meta.url).href,c):next(s,c);}});
const { continuousQuality, keepObservation, observationSchema }=await import('../lib/capture/observation.ts');
const q={sharpness:100,brightness:120,dark:0,light:0,fingerprint:Array(144).fill(.4),issues:[]};
const o={usable:true,sameProduct:'yes',addsInformation:true,shape:'flat',description:'넓은 뒷면과 가장자리',newDetails:['뒷면 표시'],visibleGaps:[],action:'review',guidance:'모은 장면을 확인해도 좋아요.'};
test('continuous movement need not stop for two seconds to produce a candidate',()=>{
 assert.equal(continuousQuality(q,0,null).usable,true);
 assert.equal(continuousQuality({...q,fingerprint:Array(144).fill(.43)},250,{quality:q,at:0}).usable,true);
});
test('fast motion, lighting and blur still reject candidate frames',()=>{
 assert.equal(continuousQuality({...q,fingerprint:Array(144).fill(.5)},250,{quality:q,at:0}).usable,false);
 assert.equal(continuousQuality({...q,brightness:145},250,{quality:q,at:0}).usable,false);
 assert.equal(continuousQuality({...q,issues:['초점 부족']},250,{quality:q,at:0}).usable,false);
});
test('flat product observations need no side quota; duplicates or uncertain identity are not selected',()=>{
 assert.ok(observationSchema.safeParse(o).success);assert.equal(keepObservation(o,true),true);
 assert.equal(keepObservation({...o,addsInformation:false},true),false);
 assert.equal(keepObservation({...o,sameProduct:'uncertain'},true),false);
 assert.equal(keepObservation({...o,usable:false},true),false);
 assert.equal(keepObservation({...o,sameProduct:'no_reference'},false),true);
 assert.equal(keepObservation(o,false),false);
});

test('a usable first scene establishes baseline even when model novelty flag is false',()=>{
 assert.equal(keepObservation({...o,addsInformation:false,sameProduct:'no_reference'},false),true);
 assert.equal(keepObservation({...o,addsInformation:false,sameProduct:'no_reference',newDetails:[]},false),false);
});
