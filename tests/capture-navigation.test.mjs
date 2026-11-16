import test from 'node:test';
import assert from 'node:assert/strict';
import { validRegionBox, motionFeedback, rotationInstruction } from '../lib/capture/navigation.ts';
import { applySupplementObservation } from '../lib/capture/supplement.ts';
const q=(value=0,issues=[])=>({sharpness:100,brightness:120,dark:0,light:0,fingerprint:Array(64).fill(value),issues});
test('region coordinates stay in their source photo; invalid or uncertain positions never get drawn',()=>{
 const box={x:.2,y:.4,width:.3,height:.25};assert.deepEqual(validRegionBox(box),box);
 for(const box of [null,{x:.9,y:0,width:.2,height:.2},{x:0,y:-.1,width:.2,height:.2},{x:0,y:0,width:0,height:.2},{x:NaN,y:0,width:.2,height:.2}])assert.equal(validRegionBox(box),null);
 const frame={image:'exact-anchor',quality:q(),at:100};
 const observation={usable:false,sameProduct:'yes',addsInformation:false,inspection:{issue:'occluded',box,region:'이음새',evidence:'손이 이음새를 가림',targetCheck:'not_requested'}};
 const task=applySupplementObservation([],frame,observation,null,true).tasks[0];assert.equal(task.anchor.image,'exact-anchor');assert.deepEqual(task.box,box);
});
test('speed feedback distinguishes stationary, fast, lighting and quality rather than asserting degrees',()=>{
 let state=null;let result;
 for(let at=250;at<=3000;at+=250){result=motionFeedback(q(),at,{quality:q(),at:at-250},state);state=result.state;}
 assert.equal(result.level,'still');assert.match(result.message,/조금 더/);
 result=motionFeedback(q(1),3250,{quality:q(),at:3000},state);assert.equal(result.level,'fast');
 result=motionFeedback(q(1,['초점을 맞춰주세요.']),3500,{quality:q(),at:3250},state);assert.equal(result.level,'quality');
 result=motionFeedback({...q(),brightness:220},3500,{quality:q(),at:3250},state);assert.equal(result.level,'quality');
 result=motionFeedback(q(),6000,{quality:q(),at:3250},state);assert.equal(result.state.stillSince,null);
 assert.match(rotationInstruction('left'),/화면 왼쪽/);assert.match(rotationInstruction('right'),/화면 오른쪽/);
});
