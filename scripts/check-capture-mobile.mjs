// Synthetic camera + mocked model responses: UI/lifecycle tests, not recognition accuracy.
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.CAPTURE_TEST_URL||'http://localhost:3014';
const output=new URL('../artifacts/capture-mobile/',import.meta.url).pathname;
fs.mkdirSync(output,{recursive:true});
const results=[];
async function fixture(page){
 await page.addInitScript(()=>{
  window.testRequests=[];window.testMode='ok';window.testSolved=false;window.testMotion=0;window.testClock=0;
  const perf=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>perf()+window.testClock});
  const original=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
   if(String(url).includes('/api/capture/status'))return Response.json({configured:true,accessRequired:false});
   if(String(url).includes('/api/capture/observe')){
    const body=JSON.parse(options.body);window.testRequests.push(body);
    if(window.testMode==='error')return Response.json({error:'모의 서버 연결 오류'},{status:502});
    if(window.testMode==='timeout')throw new DOMException('응답 시간 초과','TimeoutError');
    if(window.testMode==='slow')await new Promise(r=>{window.testResolve=r;});
    const target=body.target;const clear=!!target||window.testSolved;if(target)window.testSolved=true;
    return Response.json({latencyMs:20,observation:{usable:clear,sameProduct:'yes',addsInformation:clear,shape:'volumetric',description:'안경케이스 이음새',newDetails:clear?['이음새']:[],visibleGaps:clear?[]:['손으로 가린 이음새'],action:clear?'review':'adjust',guidance:'왼쪽 아래 가장자리',inspection:{issue:clear?'none':'occluded',region:'이음새',evidence:target?'같은 이음새가 선명함':'손이 이음새 일부를 가림',targetCheck:target?'same_region_clear':'not_requested',box:clear?null:{x:.3,y:.45,width:.35,height:.15}}}});
   }
   return original(url,options);
  };
  Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable:true, value:async()=>{
   const canvas=document.createElement('canvas');canvas.width=480;canvas.height=640;const ctx=canvas.getContext('2d');
   function draw(){ctx.fillStyle='#e5e8ef';ctx.fillRect(0,0,480,640);ctx.fillStyle='#34516e';ctx.fillRect(90+window.testMotion,180,300,260);ctx.fillStyle='#fff';ctx.font='bold 38px sans-serif';ctx.fillText('FRAME',145,290);for(let i=0;i<12;i++)ctx.fillRect(130+i*18,330,8,60);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(110,200,260,220);}
   draw();setInterval(draw,100);const stream=canvas.captureStream(10);window.testStream=stream;return stream;
  }});
  const NativeRecorder=window.MediaRecorder;
  if(NativeRecorder){window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);window.testRecorder=this;}};}
 });
}
async function visible(page,name){await page.getByRole('button',{name,exact:true}).waitFor({state:'visible'});}
async function tap(page,name){await page.getByRole('button',{name,exact:true}).tap();if(name==='계속 촬영')await page.getByText('잠시 멈췄어요',{exact:true}).waitFor({state:'hidden'});}
async function waitText(page,text){await page.getByText(text,{exact:false}).first().waitFor({state:'visible',timeout:12000});}
async function shot(page,name){await page.screenshot({path:output+name+'.png',fullPage:true});}
async function start(page){
 await page.goto(base+'/capture');await tap(page,'촬영 시작');await visible(page,'기준 정면 찍기');
 await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0);await tap(page,'기준 정면 찍기');await visible(page,'이 정면으로 촬영 시작');
 assert.equal(await page.evaluate(()=>window.testRequests.length),0,'No AI calls before user confirms front');
 await page.getByLabel('화면 왼쪽',{exact:true}).check();await tap(page,'이 정면으로 촬영 시작');
 await waitText(page,'기준 정면이 화면 왼쪽으로');
}
for(const config of [{name:'chromium-390',engine:chromium,width:390,height:844},{name:'webkit-390',engine:webkit,width:390,height:844}]){
 const browser=await config.engine.launch(config.engine===chromium?{executablePath:process.env.CHROME_PATH || chromium.executablePath(),headless:true}:{headless:true});
 const context=await browser.newContext({viewport:{width:config.width,height:config.height},isMobile:true,hasTouch:true,deviceScaleFactor:2});const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);
 try{
  await start(page);await page.waitForFunction(()=>window.testRequests.length>0);await shot(page,config.name+'-rotation');
  const request=await page.evaluate(()=>window.testRequests[0]);assert.equal(request.baseline.direction,'left');assert.equal(request.baseline.stage,'rotate');assert.ok(request.baseline.frame.startsWith('data:image/jpeg'));
  await tap(page,'한 바퀴 돌렸어요 · 보충하기');await visible(page,'보충할 부위 사진 크게 보기');await tap(page,'보충할 부위 사진 크게 보기');await waitText(page,'표시한 부분을 카메라에');await shot(page,config.name+'-marked');
  assert.equal(await page.getByRole('img',{name:'보충이 필요한 부분 (AI 추정)',exact:true}).count(),2);
  await tap(page,'사진 닫기');await page.evaluate(()=>window.testMotion=12);await page.waitForFunction(()=>window.testRequests.some(r=>r.target),{},{timeout:15000});await waitText(page,'자료를 확인해도 좋아요');
  await visible(page,'촬영 마치고 확인');assert.equal(await page.getByRole('heading',{name:'사진 확인',exact:true}).count(),0,'Model review must never navigate');
  await page.evaluate(()=>{window.testMode='error';window.testClock+=9000;});await waitText(page,'AI 연결을 잠시 멈췄어요');await shot(page,config.name+'-error');await visible(page,'계속 촬영');
  await page.evaluate(()=>window.testMode='ok');await tap(page,'계속 촬영');await waitText(page,'기준 정면으로 돌아와');
  await page.evaluate(()=>{window.testMode='timeout';window.testClock+=9000;});await waitText(page,'AI 응답이 늦어');await page.evaluate(()=>window.testMode='ok');await tap(page,'계속 촬영');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await waitText(page,'인터넷 연결이 끊겼어요');await tap(page,'계속 촬영');
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await waitText(page,'화면이 숨겨져');await tap(page,'계속 촬영');
  await page.evaluate(()=>{window.testStream.getVideoTracks()[0].dispatchEvent(new Event('ended'));window.testStream.getTracks().forEach(t=>t.stop());});await waitText(page,'카메라 연결이 끊겼어요');await tap(page,'계속 촬영');await waitText(page,'카메라를 다시 연결했어요');
  await page.evaluate(()=>window.testClock+=91000);await waitText(page,'90초 동안 촬영했어요');await shot(page,config.name+'-time-limit');await tap(page,'계속 촬영');
  for(const [width,height] of [[320,568],[360,740],[430,932],[844,390]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
   const box=await page.getByRole('button',{name:'촬영 마치고 확인',exact:true}).boundingBox();assert.ok(box.height>=44);await shot(page,config.name+`-${width}x${height}`);
  }
  await page.setViewportSize({width:390,height:844});await tap(page,'촬영 마치고 확인');await page.getByRole('heading',{name:'사진 확인',exact:true}).waitFor();await waitText(page,'사용자가 지정한 기준 정면');await shot(page,config.name+'-review');
  // Video recorder failure must degrade to photographs, not navigate or lose the reference.
  const extra=await context.newPage();extra.on('pageerror',e=>errors.push(e.message));await fixture(extra);await start(extra);
  const recorder=await extra.evaluate(()=>{if(!window.testRecorder)return false;window.testRecorder.dispatchEvent(new Event('error'));return true;});
  if(recorder){await waitText(extra,'사진');assert.equal(await extra.getByRole('heading',{name:'사진 확인',exact:true}).count(),0);await visible(extra,'촬영 마치고 확인');}
  // An in-flight result arriving after explicit finish must not modify review evidence.
  await extra.evaluate(()=>{window.testMode='slow';window.testClock+=9000;});await extra.waitForFunction(()=>!!window.testResolve);
  await tap(extra,'촬영 마치고 확인');await extra.getByRole('heading',{name:'사진 확인',exact:true}).waitFor();const countBefore=await extra.getByRole('button',{name:'이 장면 제외',exact:true}).count();
  await extra.evaluate(()=>window.testResolve());await extra.waitForTimeout(350);assert.equal(await extra.getByRole('button',{name:'이 장면 제외',exact:true}).count(),countBefore);await extra.close();
  const denied=await context.newPage();await fixture(denied);await denied.addInitScript(()=>Object.defineProperty(MediaDevices.prototype,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError');}}));await denied.goto(base+'/capture');await tap(denied,'촬영 시작');await waitText(denied,'카메라 권한을 허용');await visible(denied,'촬영 시작');await denied.close();
  assert.deepEqual(errors,[]);results.push({browser:config.name,passed:true,checks:['front confirmation before inference','left direction persists','anchored region overlay and enlargement','manual supplement stage','model review does not finish','502 recovery','timeout recovery','offline recovery','background recovery','camera-ended recovery','90s pause/resume','four mobile sizes and landscape','touch controls','explicit finish preserves front','recorder error keeps capture screen','late response ignored after finish','camera permission rejection retry']});
 }catch(e){await shot(page,config.name+'-failure');results.push({browser:config.name,passed:false,error:e.stack});console.error(config.name,e);}
 finally{await browser.close();}
}
fs.writeFileSync(output+'results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
