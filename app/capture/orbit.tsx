'use client';
/* eslint-disable @next/next/no-img-element */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StudioNav from '../studio-nav';
import { createHandoff } from '@/lib/prompt-engine/handoff';
import { prepareImage, saveHandoff } from '@/lib/prompt-engine/browser';
import { getSessionCode, setSessionCode } from '@/lib/prompt-engine/session';
import { useEffect, useRef, useState } from 'react';
import { analyzePixels, duplicateDistance, type Quality } from '@/lib/capture/quality';
import { continuousQuality, keepObservation, observationSchema, ORBIT_POLICY, type Observation } from '@/lib/capture/observation';
import { applySupplementObservation, deferSupplement, excludeSupplementEvidence, localBlur, nextSupplement, openSupplement, supplementGuidance, SUPPLEMENT_LABELS, SUPPLEMENT_POLICY, type Supplement } from '@/lib/capture/supplement';
import { createZip } from '@/lib/capture/zip';
import s from './orbit.module.css';

type Frame = { image: string; quality: Quality; at: number };
type Evidence = Frame & { observation: Observation; kept: boolean; latencyMs: number };
type Connection = { configured: boolean; accessRequired: boolean };
function download(blob: Blob, name: string) { const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000); }
function sample(v: HTMLVideoElement, aspect: number): Frame {
  // Sample the same center crop that object-fit:cover displays; the full sensor video stays in the recording.
  let w=v.videoWidth,h=v.videoHeight;if(w/h>aspect)w=h*aspect;else h=w/aspect;
  const c=document.createElement('canvas'),r=Math.min(1,960/Math.max(w,h));c.width=Math.round(w*r);c.height=Math.round(h*r);
  c.getContext('2d')!.drawImage(v,(v.videoWidth-w)/2,(v.videoHeight-h)/2,w,h,0,0,c.width,c.height);
  const q=document.createElement('canvas');q.width=q.height=160;const side=Math.min(c.width,c.height)*.8;
  q.getContext('2d')!.drawImage(c,(c.width-side)/2,(c.height-side)/2,side,side,0,0,160,160);
  return {image:c.toDataURL('image/jpeg',.82),quality:analyzePixels(q.getContext('2d')!.getImageData(0,0,160,160).data,160,160),at:0};
}
export default function OrbitCapture(){
 const router = useRouter();
 const [demo,setDemo]=useState(false);
 const [phase,setPhase]=useState<'intro'|'capture'|'review'>('intro');
 const [config,setConfig]=useState<Connection|null>(null),[code,setCode]=useState(''),[error,setError]=useState('');
 const [opening,setOpening]=useState(false),[saving,setSaving]=useState(false),[finalizing,setFinalizing]=useState(false);
 const [guidance,setGuidance]=useState('제품을 천천히 돌려주세요.'),[qualityHint,setQualityHint]=useState('');
 const [seconds,setSeconds]=useState(0),[busy,setBusy]=useState(false),[reviewSuggested,setReviewSuggested]=useState(false);
 const [selected,setSelected]=useState<Evidence[]>([]),[history,setHistory]=useState<Evidence[]>([]),[reviewed,setReviewed]=useState(false);
 const [supplements,setSupplements]=useState<Supplement[]>([]);
 const supplementRef=useRef<Supplement[]>([]);
 function updateSupplements(next: Supplement[]){supplementRef.current=next;setSupplements(next);}
 const activeSupplement=nextSupplement(supplements);
 const unresolved=supplements.filter(t=>t.status!=='improved').length;
 const [clip,setClip]=useState<Blob|null>(null),[clipURL,setClipURL]=useState(''),[recording,setRecording]=useState(false);
 const video=useRef<HTMLVideoElement>(null),camera=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null);
 const live=useRef(true),session=useRef(0),abort=useRef<AbortController|null>(null),url=useRef(''),started=useRef(0),pending=useRef(false);
 const saved=useRef<Evidence[]>([]),qualityLog=useRef<object[]>([]),stopRef=useRef<(message?:string)=>void>(()=>{});
 async function connection(){const r=await fetch('/api/capture/status',{cache:'no-store'});if(!r.ok)throw new Error('연결 상태를 확인하지 못했어요. 다시 시도해주세요.');const c:Connection=await r.json();if(live.current)setConfig(c);return c;}
 useEffect(()=>{live.current=true;setCode(getSessionCode());void connection().catch(e=>{if(live.current)setError(e.message);});const media=stream,rec=recorder,token=session,l=live,a=abort,u=url;return()=>{l.current=false;token.current++;a.current?.abort();if(rec.current?.state==='recording')rec.current.stop();media.current?.getTracks().forEach(t=>t.stop());if(u.current)URL.revokeObjectURL(u.current);};},[]);
 function stop(message?:string){if(!stream.current)return;abort.current?.abort();pending.current=false;setBusy(false);if(recorder.current?.state==='recording'){setFinalizing(true);recorder.current.stop();}stream.current.getTracks().forEach(t=>t.stop());stream.current=null;setPhase('review');setRecording(false);if(message)setError(message);}
 useEffect(()=>{stopRef.current=stop;});
 async function begin(){
  setDemo(false);setSessionCode(code);const id=++session.current;setOpening(true);setError('');
  try{
   const c=await connection();if(!c.configured)throw new Error('AI 연결을 확인해주세요.');if(c.accessRequired&&!code.trim())throw new Error('데모 접근 코드를 입력해주세요.');
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:720},height:{ideal:1280}},audio:false});
   if(!live.current||id!==session.current){media.getTracks().forEach(t=>t.stop());return;}
   stream.current=media;recorder.current=null;saved.current=[];qualityLog.current=[];updateSupplements([]);pending.current=false;setSelected([]);setHistory([]);setReviewed(false);setReviewSuggested(false);setSeconds(0);setClip(null);setClipURL('');setFinalizing(false);setRecording(false);setQualityHint('');setGuidance('제품을 천천히 돌려주세요.');if(url.current)URL.revokeObjectURL(url.current);url.current='';
   media.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(live.current&&session.current===id&&stream.current===media)stopRef.current('카메라가 끊겼어요. 모은 자료는 저장할 수 있어요.');}));
   if(typeof MediaRecorder!=='undefined')try{
    const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));const rec=new MediaRecorder(media,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:1_800_000});const parts:Blob[]=[];let bytes=0;
    rec.ondataavailable=e=>{if(e.data.size&&session.current===id){parts.push(e.data);bytes+=e.data.size;if(bytes>30*1024*1024)stopRef.current('녹화 용량에 도달했어요. 모은 자료를 확인해주세요.');}};
    rec.onstop=()=>{if(!live.current||session.current!==id)return;if(stream.current===media)stopRef.current('녹화가 중단됐어요. 모은 자료를 확인해주세요.');if(parts.length){const b=new Blob(parts,{type:rec.mimeType});setClip(b);url.current=URL.createObjectURL(b);setClipURL(url.current);}setFinalizing(false);};
    rec.onerror=()=>{if(live.current&&session.current===id)stopRef.current('녹화 오류가 발생했어요. 선별 사진을 확인해주세요.');};recorder.current=rec;rec.start(1000);setRecording(true);
   }catch{setRecording(false);}
   started.current=performance.now();setPhase('capture');
  }catch(e){if(live.current&&id===session.current)setError(e instanceof DOMException?'카메라 권한을 허용하고 다시 시작해주세요.':(e as Error).message);}finally{if(live.current&&id===session.current)setOpening(false);}
 }
 useEffect(()=>{
  if(phase!=='capture'||!video.current)return;video.current.srcObject=stream.current;const id=session.current;
  let previous:{quality:Quality;at:number}|null=null,candidate:Frame|null=null,lastCall=-ORBIT_POLICY.intervalMs,calls=0,lastLog=-1000,blurSince:number|null=null,blurLastAt=0,blurRecorded=false;
  const timer=window.setInterval(()=>{
   const elapsed=performance.now()-started.current;setSeconds(Math.floor(elapsed/1000));
   if(elapsed>=ORBIT_POLICY.seconds*1000){stopRef.current('촬영 시간이 끝났어요. 모은 장면을 확인해주세요.');return;}
   const v=video.current,box=camera.current;if(!v?.videoWidth||v.paused||!box||box.clientWidth<1||box.clientHeight<1)return;
   const f=sample(v,box.clientWidth/box.clientHeight);f.at=elapsed;const q=continuousQuality(f.quality,elapsed,previous);previous={quality:f.quality,at:elapsed};setQualityHint(q.reason);
   if(localBlur(f.quality)){
    if(blurSince===null||elapsed-blurLastAt>SUPPLEMENT_POLICY.maxSampleGapMs){blurSince=elapsed;blurRecorded=false;}
    blurLastAt=elapsed;
    if(!blurRecorded&&elapsed-blurSince>=SUPPLEMENT_POLICY.blurDurationMs){
     updateSupplements(openSupplement(supplementRef.current,'blurred',f,'흐렸던 장면 · 위치 미확인','중앙 영역의 선명한 경계가 1초 이상 부족했어요. 무늬가 적은 제품도 이렇게 보일 수 있어요.','local-quality'));
     blurRecorded=true;setReviewSuggested(false);
    }
   }else{blurSince=null;blurRecorded=false;}
   if(!q.usable)candidate=null;
   if(elapsed-lastLog>=1000){qualityLog.current.push({at:elapsed,brightness:f.quality.brightness,sharpness:f.quality.sharpness,dark:f.quality.dark,light:f.quality.light,...q});lastLog=elapsed;}
   if(candidate&&elapsed-candidate.at>1500)candidate=null;
   // Buffer recent clear frames while the user keeps moving; no stop timer or face slots.
   if(q.usable&&(!candidate||f.quality.sharpness>=candidate.quality.sharpness))candidate=f;
   if(pending.current||!q.usable||!candidate||elapsed-lastCall<ORBIT_POLICY.intervalMs)return;
   if(calls>=ORBIT_POLICY.maxCalls){stopRef.current('이번 촬영의 자동 선별을 마쳤어요. 자료를 확인해주세요.');return;}
   const frame=candidate;const nearest=Math.min(...saved.current.map(e=>duplicateDistance(e.quality.fingerprint,frame.quality.fingerprint)));
   const target=nextSupplement(supplementRef.current);
   if(!target&&saved.current.length&&nearest<ORBIT_POLICY.noveltyDistance&&elapsed-lastCall<ORBIT_POLICY.revisitMs)return;
   candidate=null;lastCall=elapsed;calls++;pending.current=true;setBusy(true);const controller=new AbortController();abort.current=controller;
   // First view anchors identity; recent diverse views give incremental context. Full history is exported.
   const refs=saved.current.length>4?[saved.current[0],...saved.current.slice(-3)]:saved.current.slice();
   void(async()=>{try{
    const r=await fetch('/api/capture/observe',{method:'POST',headers:{'Content-Type':'application/json','x-capture-code':code},body:JSON.stringify({frame:frame.image,references:refs.map(e=>({frame:e.image,description:e.observation.description})),...(target?{target:{id:target.id,kind:target.kind,region:target.region,reason:target.reason,frame:target.anchor.image}}:{})}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(26_000)])});const data=await r.json();if(!r.ok)throw new Error(data.error||'AI 연결을 확인해주세요.');
    if(!live.current||session.current!==id||!stream.current)return;
    const observation=observationSchema.parse(data.observation);
    const result=applySupplementObservation(supplementRef.current,frame,observation,target?.id??null,true);
    updateSupplements(result.tasks);
    const kept=keepObservation(observation,refs.length>0)||Boolean(result.improvedId);const entry:Evidence={...frame,observation,kept,latencyMs:data.latencyMs};setHistory(p=>[...p,entry]);
    if(kept){saved.current=[...saved.current,entry];setSelected([...saved.current]);}
    setGuidance(observation.guidance);setReviewSuggested(observation.action==='review'&&observation.visibleGaps.length===0&&saved.current.length>=2&&!result.tasks.some(t=>t.status!=='improved'));
   }catch(e){if(live.current&&session.current===id&&stream.current&&!controller.signal.aborted)stopRef.current((e as Error).message);}finally{if(live.current&&session.current===id){pending.current=false;setBusy(false);}}})();
  },250);return()=>clearInterval(timer);
 },[phase,code]);
 async function continueToPrompt(){
  setSaving(true);setError('');
  try{
   const packet=createHandoff({id:crypto.randomUUID(),createdAt:new Date().toISOString(),reviewed,demo,frames:selected.map(e=>({image:e.image,at:e.at,description:e.observation.description})),unresolved:supplements.filter(t=>t.status!=='improved').map(t=>`${t.region}: ${t.reason}`)});
   await saveHandoff(packet);setSessionCode(code);router.push(`/prompt?capture=${packet.id}`);
  }catch(e){setError(e instanceof Error?e.message:'사진을 연결하지 못했어요. 촬영 자료를 파일로 저장한 뒤 다시 시도해주세요.');setSaving(false);}
 }
 async function tryExample(){
  setOpening(true);setError('');
  try{
   const response=await fetch('/prompt/lumi-reference.png');if(!response.ok)throw new Error();
   const image=await prepareImage(new File([await response.blob()],'LUMI 체험 사진.png',{type:'image/png'}));
   const entry: Evidence={image,at:0,quality:{sharpness:0,brightness:0,dark:0,light:0,fingerprint:[],issues:['체험 사진 · 측정하지 않음']},observation:{usable:true,sameProduct:'no_reference',addsInformation:true,shape:'unknown',description:'LUMI 가상 세럼 · 정면 예시',newDetails:[],visibleGaps:[],action:'review',guidance:'체험 사진을 확인해주세요.'},kept:true,latencyMs:0};
   setDemo(true);setSelected([entry]);setHistory([entry]);setReviewed(false);setClip(null);setClipURL('');updateSupplements([]);setPhase('review');
  }catch{setError('체험 사진을 불러오지 못했어요. 다시 시도해주세요.');}finally{setOpening(false);}
 }
 async function exportAll(){setSaving(true);try{
  const bytes=(image:string)=>Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
  const files=history.map((e,i)=>({name:`evidence/frame-${i+1}.jpg`,data:bytes(e.image)}));
  selected.forEach((e,i)=>files.push({name:`selected/scene-${i+1}.jpg`,data:bytes(e.image)}));
  if(clip)files.push({name:clip.type.includes('mp4')?'capture.mp4':'capture.webm',data:new Uint8Array(await clip.arrayBuffer())});
  const supplementRecords=supplements.map(t=>{
   const anchorFile=`supplements/${t.id}-anchor.jpg`;files.push({name:anchorFile,data:bytes(t.anchor.image)});
   const supportFile=t.support?`supplements/${t.id}-support.jpg`:null;
   if(t.support&&supportFile)files.push({name:supportFile,data:bytes(t.support.image)});
   return {...t,anchor:{...t.anchor,image:undefined,file:anchorFile},support:t.support?{...t.support,image:undefined,file:supportFile}:null};
  });
  const manifest={version:6,supplementPolicy:SUPPLEMENT_POLICY,supplements:supplementRecords,unresolvedSupplementCount:unresolved,mode:demo?'illustrative-demo':'continuous-information-selection',policy:ORBIT_POLICY,qualityTimeline:qualityLog.current,reviewConfirmed:reviewed,coverage:'not-certified',evidence:history.map((item,i)=>{const e={...item,image:undefined};return({...e,file:`evidence/frame-${i+1}.jpg`,selectedByUser:selected.some(s=>s.at===e.at)});}),limits:['Supplement classifications and same-region comparisons are model estimates, not geometric tracking or full coverage. Local low sharpness is not confirmed blur.','Sampled frames, not full-video reasoning or 3D reconstruction.','No fixed face quota. New information and sufficiency are model estimates.','Quality thresholds are provisional and measured on center crop.','Only first and three latest selected frames are model context after four selections.']};
  files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});download(new Blob([new Uint8Array(createZip(files))],{type:'application/zip'}),'frame-continuous-capture.zip');
 }catch{setError('자료 저장에 실패했어요. 영상부터 따로 저장해주세요.');}finally{setSaving(false);}}
 return <main className={s.app} lang="ko">
 {phase==='capture'?<section className={s.capture}>
  <header className={s.captureHeader}><strong>FRAME</strong><span>{recording?'녹화 중':'사진 수집 중'} · {seconds}초</span></header>
  <div className={s.camera} ref={camera}><video ref={video} autoPlay playsInline muted/><div className={s.frameGuide} aria-hidden="true"/>
   <div className={s.overlay}><span>{qualityHint?'촬영 안내':busy?'장면을 살펴보고 있어요':'계속 움직여도 괜찮아요'}</span><p role="status">{qualityHint||(activeSupplement?supplementGuidance(activeSupplement):guidance)}</p></div>
  </div>
  <div className={s.captureBottom}>
   {activeSupplement&&<div className={s.supplementPrompt}>
    <img src={activeSupplement.anchor.image} alt="다시 확인할 촬영 장면"/>
    <div><strong>{SUPPLEMENT_LABELS[activeSupplement.kind]}</strong><span>{activeSupplement.region}</span>
    <button onClick={()=>{updateSupplements(deferSupplement(supplementRef.current,activeSupplement.id,performance.now()-started.current));setReviewSuggested(false);}}>지금은 어려워요 · 미확보로 남기기</button></div>
   </div>}
   <p>{unresolved?`보충 확인 ${unresolved}건 · 확보율이 아니에요`:reviewSuggested?'모은 장면을 한 번 확인해도 좋아요.':'선명하고 새로운 장면은 자동으로 모아둘게요.'}</p><button className={s.primary} onClick={()=>stop()}>촬영 마치고 확인</button></div>
 </section>:<div className={s.shell}>
  <StudioNav active="capture" />
  {error&&<p role="alert" className={s.error}>{error}</p>}
  {phase==='intro'?<div className={s.introLayout}><section className={s.intro}><h1>제품을 담고,<br/>다음 장면을 준비해요.</h1><p>제품 전체를 화면에 담고 자연스럽게 돌려보세요.<br/>멈추거나 면을 구분할 필요 없어요.</p><div className={s.instructions}><p>휴대폰을 편하게 고정하고 제품을 천천히 돌려주세요.</p><p>같은 쪽 반복·흐림·가림이 의심되면 보충 촬영을 안내할게요.</p><p>무겁다면 제품을 두고 휴대폰으로 주변을 천천히 돌아도 돼요.</p></div>
   <div className={s.startPanel}><div className={s.connection}><span>{config?.configured?'촬영 준비됨':'AI 연결 확인 필요'}</span><button onClick={()=>{setError('');void connection().catch(e=>setError(e.message));}}>다시 확인</button></div>
    {config?.accessRequired&&<label>데모 접근 코드<input type="password" value={code} onChange={e=>setCode(e.target.value)} autoComplete="off"/></label>}
    <button className={s.primary} disabled={opening||!config?.configured} onClick={()=>void begin()}>{opening?'카메라 여는 중…':'촬영 시작'}</button>
    <button className={s.secondary} disabled={opening} onClick={()=>void tryExample()}>예시 사진으로 연결 체험</button><p className={s.note}>최대 90초 · 소리 없이 촬영<br/>선별 후보 사진과 이전 장면을 OpenAI로 보내요. 전체 영상은 기기에 남아요.</p>
   </div><p className={s.note}>무늬가 있는 불투명한 제품부터 촬영해주세요. 투명·유광·대칭 제품은 판단이 어려워요. 모든 표면의 확보나 3D 복원을 보장하지 않아요.</p><Link className={s.directLink} href="/prompt">이미 사진이 있나요? 바로 연출 기획하기</Link></section><figure className={s.heroImage}><img src="/studio/scene.jpg" alt="가상 세럼의 제품 촬영 연출 예시"/><figcaption><strong>작은 제품에서 시작되는<br/>다음 장면.</strong><span>AI로 만든 연출 예시 · 실제 촬영 결과가 아닙니다.</span></figcaption></figure></div>:<section className={s.review}>
   <h1>{demo?'예시 사진으로 이어가 볼까요?':'이 장면들을 모았어요.'}</h1>{demo&&<p className={s.demoNote}>가상 화장품 체험 사진입니다. 실제 카메라 촬영·AI 선별 결과가 아니에요.</p>}<p>실제 제품과 맞고, 필요한 부분이 보이는지 확인해주세요.</p>
   {finalizing?<p role="status">영상을 마무리하고 있어요…</p>:clipURL?<div className={s.recording}><video src={clipURL} controls playsInline/><button onClick={()=>clip&&download(clip,clip.type.includes('mp4')?'capture.mp4':'capture.webm')}>영상만 저장</button></div>:<p>녹화 영상은 없어요. 선별 사진과 기록은 저장할 수 있어요.</p>}
   {supplements.length>0&&<section className={s.supplementReview} aria-label="보충 촬영 기록">
    <h2>보충 촬영 확인</h2><p>{unresolved?`아직 확인하지 못한 항목 ${unresolved}건이 있어요. 부분 자료로 저장할 수 있어요.`:'각 항목의 보충 장면을 모았어요. 실제로 개선됐는지 사진을 확인해주세요.'}</p>
    {supplements.map(t=><article key={t.id}>
     <img src={t.anchor.image} alt={`${SUPPLEMENT_LABELS[t.kind]} 기준 장면`}/>
     <div><strong>{SUPPLEMENT_LABELS[t.kind]} · {t.status==='improved'?'보충 장면 확보 (AI 추정)':t.status==='deferred'?'보류 · 미확보':'확인 필요'}</strong><p>{t.region}</p><small>{t.reason}</small>
      {t.support&&<a href={t.support.image} download={`${t.id}-support.jpg`}>보충 사진 보기·저장<img src={t.support.image} alt={`${t.region} 보충 장면`}/></a>}
     </div>
    </article>)}
    <p className={s.note}>반복·가림·같은 부분 여부는 AI 추정이에요. 흐림 의심은 중앙 영역의 선명도 신호예요. 미촬영 면의 위치나 제품 전체 확보율을 측정한 것은 아니에요.</p>
   </section>}
   {selected.length?<div className={s.scenes}>{selected.map(e=><article key={e.at}><a href={e.image} download={`scene-${Math.round(e.at)}.jpg`}><img src={e.image} alt={e.observation.description}/></a><div><p>{e.observation.description}</p><small>{(e.at/1000).toFixed(1)}초</small><button onClick={()=>{setSelected(p=>p.filter(x=>x.at!==e.at));updateSupplements(excludeSupplementEvidence(supplementRef.current,e.at));setReviewed(false);}}>이 장면 제외</button></div></article>)}</div>:<p className={s.empty}>자동 선별한 장면이 없어요. 녹화 영상이 있다면 먼저 저장하고 조명과 속도를 바꿔 다시 촬영해주세요.</p>}
   {config?.accessRequired&&<details className={s.details} open={error.includes('코드')}><summary>접근 코드 수정</summary><label>데모 접근 코드<input type="password" value={code} onChange={e=>setCode(e.target.value)}/></label></details>}
   <label className={s.check}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>선별된 장면과 부족한 부분을 확인했어요.</label>
   <button className={s.primary} disabled={!reviewed||saving||finalizing||!selected.length} onClick={()=>void continueToPrompt()}>{saving?'사진을 연결하고 있어요…':'이 사진으로 연출 기획하기'}</button><p className={s.note}>선택한 사진이 그대로 이어져요. 다음 화면에서는 원하는 느낌만 알려주세요.</p><button className={s.secondary} disabled={!reviewed||saving||finalizing||(!history.length&&!clip)} onClick={()=>void exportAll()}>{saving?'저장 준비 중…':'영상과 선별 장면 저장'}</button><button className={s.secondary} disabled={finalizing||saving} onClick={()=>{if(window.confirm('현재 자료를 저장했나요? 다시 촬영하면 현재 자료가 사라져요.'))void begin();}}>다시 촬영</button>
   <details className={s.details}><summary>선별 기록 · {history.length}건</summary>{history.map((e,i)=><p key={i}>{(e.at/1000).toFixed(1)}초 · {e.kept?'선별':'제외'} · {e.observation.description}<br/>추가로 보인 정보: {e.observation.newDetails.join(', ')||'없음'}<br/>확인하지 못한 부분: {e.observation.visibleGaps.join(', ')||'모델이 지적한 부분 없음'}</p>)}</details><p className={s.note}>사진 개수는 완성도가 아니에요. 자동 선별에는 오판이 있을 수 있고, 영상의 모든 순간을 AI가 분석한 것은 아니에요.</p>
  </section>}<footer className={s.footer}>FRAME · 촬영 → 연출 기획 → 제작 계획 | 전체 영상은 이동 전에 저장해주세요.</footer>
 </div>}
 </main>;
}
