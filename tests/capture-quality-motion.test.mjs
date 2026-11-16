import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels, evaluateCaptureFrame } from '../lib/capture/quality.ts';
const base = { sharpness: 100, brightness: 120, dark: 0, light: 0, fingerprint: Array(144).fill(.4), issues: [] };
function hold() { let g; for(let t=0;t<=2250;t+=250) g=evaluateCaptureFrame(base,t,g?.state ?? null); return g; }
test('requires measured two seconds of continuous stable quality, not frame count', () => {
 let g; for(let t=0;t<=2000;t+=250) g=evaluateCaptureFrame(base,t,g?.state ?? null);
 assert.equal(g.ready,false);assert.equal(g.heldMs,1750);
 g=evaluateCaptureFrame(base,2250,g.state);assert.equal(g.ready,true);assert.equal(g.heldMs,2000);
});
test('motion resets hold and invalidates an in-flight confirmation epoch', () => {
 const good=hold(); const moving=evaluateCaptureFrame({...base,fingerprint:Array(144).fill(.5)},2500,good.state);
 assert.equal(moving.ready,false);assert.equal(moving.heldMs,0);assert.ok(moving.reason.includes('천천히'));assert.notEqual(moving.state.epoch,good.state.epoch);
});
test('lighting changes and quality faults reset the hold even when image shape stays still', () => {
 const good=hold();
 const lighting=evaluateCaptureFrame({...base,brightness:145},2500,good.state);
 assert.equal(lighting.ready,false);assert.ok(lighting.reason.includes('밝기'));
 assert.equal(evaluateCaptureFrame({...base,issues:['초점 부족']},2500,good.state).ready,false);
});
test('long frame gaps cannot count as stable time', () => {
 const good=hold();const resumed=evaluateCaptureFrame(base,5000,good.state);
 assert.equal(resumed.ready,false);assert.equal(resumed.heldMs,0);
});
test('large clipped highlight region fails even when mean brightness is moderate', () => {
 const pixels=new Uint8ClampedArray(160*160*4);
 for(let i=0;i<160*160;i++){const v=i%160<80?255:90;pixels.set([v,v,v,255],i*4);}
 const q=analyzePixels(pixels,160,160);assert.ok(q.brightness<246);assert.equal(q.light,.5);assert.ok(q.issues.some(x=>x.includes('반사')));
});
test('small alternating hand tremor advances the hold instead of restarting', () => {
 let g;
 for(let t=0;t<=2250;t+=250) g=evaluateCaptureFrame({...base,fingerprint:Array(144).fill(t%500===0?.39:.41)},t,g?.state??null);
 assert.equal(g.ready,true);assert.equal(g.heldMs,2000);
});
test('brief moderate shake pauses without discarding accumulated hold time', () => {
 let g;for(let t=0;t<=1250;t+=250)g=evaluateCaptureFrame(base,t,g?.state??null);
 const held=g.heldMs;
 g=evaluateCaptureFrame({...base,fingerprint:Array(144).fill(.44)},1500,g.state);
 assert.equal(g.ready,false);assert.equal(g.heldMs,held);
 g=evaluateCaptureFrame(base,1750,g.state);assert.equal(g.heldMs,held);
 for(let t=2000;t<=2750;t+=250)g=evaluateCaptureFrame(base,t,g.state);
 assert.equal(g.ready,true);
});
test('slow accumulated rotation still resets despite small adjacent-frame changes', () => {
 let g;
 for(let t=0;t<=5000;t+=250){g=evaluateCaptureFrame({...base,fingerprint:Array(144).fill(.2+t/250*.012)},t,g?.state??null);assert.equal(g.ready,false);}
});
test('sustained moderate movement resets instead of pausing forever', () => {
 let g=hold();
 for(let i=1;i<=3;i++)g=evaluateCaptureFrame({...base,fingerprint:Array(144).fill(i%2?.44:.4)},2250+i*250,g.state);
 assert.equal(g.heldMs,0);assert.equal(g.ready,false);
});
test('two-pixel image jitter with real pixel analysis can finish the hold', () => {
 let g;
 for(let t=0;t<=2250;t+=250){
  const shift=t%500===0?-2:2;const pixels=new Uint8ClampedArray(160*160*4);
  for(let y=0;y<160;y++)for(let x=0;x<160;x++){
   const px=x-shift;const inside=px>=40&&px<120&&y>=30&&y<130;
   const v=inside?(px%16<8?70:140):210;const i=(y*160+x)*4;pixels.set([v,v,v,255],i);
  }
  const q=analyzePixels(pixels,160,160);assert.equal(q.issues.length,0);
  g=evaluateCaptureFrame(q,t,g?.state??null);
 }
 assert.equal(g.ready,true);assert.ok(g.changePerSecond>.035,'fixture must fail the previous threshold');
});
