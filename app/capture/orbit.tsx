'use client';
/* eslint-disable @next/next/no-img-element */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StudioNav from '../studio-nav';
import { createHandoff } from '@/lib/prompt-engine/handoff';
import { prepareImage, saveHandoff } from '@/lib/prompt-engine/browser';
import { useEffect, useRef, useState } from 'react';
import { analyzePixels, duplicateDistance, type Quality } from '@/lib/capture/quality';
import { continuousQuality, keepObservation, observationSchema, ORBIT_POLICY, type Observation } from '@/lib/capture/observation';
import { applySupplementObservation, deferSupplement, excludeSupplementEvidence, localBlur, nextSupplement, openSupplement, supplementGuidance, SUPPLEMENT_LABELS, SUPPLEMENT_POLICY, type Supplement } from '@/lib/capture/supplement';
import { motionFeedback, rotationInstruction, SESSION_LIMITS, type MotionState, type CaptureEvent, type CaptureStage, type RotationDirection } from '@/lib/capture/navigation';
import { MarkedPhoto } from './marked-photo';
import { createZip } from '@/lib/capture/zip';
import s from './orbit.module.css';

type Frame = { image: string; quality: Quality; at: number };
type Evidence = Frame & { observation: Observation; kept: boolean; latencyMs: number };
type Connection = { configured: boolean; };
function download(blob: Blob, name: string) { const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000); }
function sample(v: HTMLVideoElement): Frame {
  // Keep the complete camera image, matching object-fit:contain and annotation coordinates.
  const w=v.videoWidth,h=v.videoHeight;
  const c=document.createElement('canvas'),r=Math.min(1,960/Math.max(w,h));c.width=Math.round(w*r);c.height=Math.round(h*r);
  c.getContext('2d')!.drawImage(v,(v.videoWidth-w)/2,(v.videoHeight-h)/2,w,h,0,0,c.width,c.height);
  const q=document.createElement('canvas');q.width=q.height=160;const side=Math.min(c.width,c.height)*.8;
  q.getContext('2d')!.drawImage(c,(c.width-side)/2,(c.height-side)/2,side,side,0,0,160,160);
  return {image:c.toDataURL('image/jpeg',.82),quality:analyzePixels(q.getContext('2d')!.getImageData(0,0,160,160).data,160,160),at:0};
}
export default function OrbitCapture(){
 const router = useRouter();
 const [demo,setDemo]=useState(false);
 const [phase,setPhase]=useState<'intro'|'align'|'capture'|'review'>('intro');
 const [config,setConfig]=useState<Connection|null>(null),[error,setError]=useState('');
 const [opening,setOpening]=useState(false),[saving,setSaving]=useState(false),[finalizing,setFinalizing]=useState(false);
 const [qualityHint,setQualityHint]=useState('');
 const [seconds,setSeconds]=useState(0),[busy,setBusy]=useState(false),[reviewSuggested,setReviewSuggested]=useState(false);
 const [selected,setSelected]=useState<Evidence[]>([]),[history,setHistory]=useState<Evidence[]>([]),[reviewed,setReviewed]=useState(false);
 const [supplements,setSupplements]=useState<Supplement[]>([]);
 const supplementRef=useRef<Supplement[]>([]);
 function updateSupplements(next: Supplement[]){supplementRef.current=next;setSupplements(next);}
 const availableSupplement=nextSupplement(supplements);
 const unresolved=supplements.filter(t=>t.status!=='improved').length;
 const [clip,setClip]=useState<Blob|null>(null),[clipURL,setClipURL]=useState(''),[recording,setRecording]=useState(false);
 const video=useRef<HTMLVideoElement>(null),camera=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null);
 const live=useRef(true),session=useRef(0),abort=useRef<AbortController|null>(null),url=useRef(''),started=useRef(0),pending=useRef(false);
 const saved=useRef<Evidence[]>([]),qualityLog=useRef<object[]>([]);
 const [baseline,setBaseline]=useState<Frame|null>(null),[frontCandidate,setFrontCandidate]=useState<Frame|null>(null);
 const [direction,setDirection]=useState<RotationDirection>('right'),[stage,setStage]=useState<CaptureStage>('rotate');
 const baselineRef=useRef<Frame|null>(null),directionRef=useRef<RotationDirection>('right'),stageRef=useRef<CaptureStage>('rotate');
 const [captureEvents,setCaptureEvents]=useState<CaptureEvent[]>([]),[callLimit,setCallLimit]=useState(false);
 const [pauseMessage,setPauseMessage]=useState(''),[cameraReady,setCameraReady]=useState(false),[cameraVersion,setCameraVersion]=useState(0);
 const [speed,setSpeed]=useState('천천히 회전을 시작해주세요.'),[notice,setNotice]=useState(''),[enlarged,setEnlarged]=useState<Supplement|null>(null);
 const paused=useRef(false),pauseAt=useRef(0),segmentStart=useRef(0),segmentCalls=useRef(0),totalCalls=useRef(0),requestEpoch=useRef(0);
 const capturePhase=useRef<'intro'|'align'|'capture'|'review'>('intro'),events=useRef<CaptureEvent[]>([]);
 const pauseRef=useRef<(reason:string,detail:string)=>void>(()=>{});
 function log(reason:string,detail:string){events.current.push({at:started.current?Math.max(0,performance.now()-started.current):0,reason,detail});setCaptureEvents([...events.current]);}
 function movePhase(next:'intro'|'align'|'capture'|'review'){capturePhase.current=next;setPhase(next);}
 function pauseCapture(reason:string,detail:string){
  if(!['align','capture'].includes(capturePhase.current))return;
  log(reason,detail);setCallLimit(totalCalls.current>=SESSION_LIMITS.totalCalls);if(!paused.current)pauseAt.current=performance.now();paused.current=true;
  requestEpoch.current++;abort.current?.abort();pending.current=false;setBusy(false);setPauseMessage(detail);
  if(recorder.current?.state==='recording')try{recorder.current.pause();}catch{setNotice('영상 일시정지를 지원하지 않아요. 사진은 보존됩니다.');}
 }
 useEffect(()=>{pauseRef.current=pauseCapture;});
 async function connection(){const r=await fetch('/api/capture/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('연결 상태를 확인하지 못했어요. 다시 시도해주세요.');const c:Connection=await r.json();if(live.current)setConfig(c);return c;}
 useEffect(()=>{
  live.current=true;void connection().catch(e=>{if(live.current)setError(e.message);});
  const visibility=()=>{if(document.hidden)pauseRef.current('background','다른 화면으로 이동해 잠시 멈췄어요. 준비되면 계속 촬영하세요.');};
  const offline=()=>pauseRef.current('offline','인터넷 연결이 끊겼어요. 연결 후 계속 촬영하세요.');
  const pagehide=()=>pauseRef.current('page-hidden','화면이 숨겨져 잠시 멈췄어요.');
  document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('pagehide',pagehide);
  const media=stream,rec=recorder,token=session,l=live,a=abort,u=url;
  return()=>{l.current=false;token.current++;a.current?.abort();if(rec.current&&rec.current.state!=='inactive')rec.current.stop();media.current?.getTracks().forEach(t=>t.stop());if(u.current)URL.revokeObjectURL(u.current);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('pagehide',pagehide);};
 },[]);
 function watchCamera(media:MediaStream,id:number){
  media.getVideoTracks().forEach(t=>{
   t.addEventListener('ended',()=>{if(live.current&&session.current===id&&stream.current===media)pauseRef.current('camera-ended','카메라 연결이 끊겼어요. 카메라를 다시 연결해 계속할 수 있어요.');});
   t.addEventListener('mute',()=>{if(live.current&&session.current===id&&stream.current===media)pauseRef.current('camera-muted','카메라가 잠시 멈췄어요. 화면으로 돌아온 뒤 계속 촬영하세요.');});
  });
 }
 function finishRecording(){
  const rec=recorder.current;if(rec&&rec.state!=='inactive'){
   setFinalizing(true);try{rec.stop();}catch{setFinalizing(false);}
  }
  setRecording(false);
 }
 // Only an explicit user action leaves the capture screen. Device/network/model events pause.
 function stop(){
  log('user-finish','사용자가 촬영 마치고 확인을 선택함');movePhase('review');requestEpoch.current++;abort.current?.abort();pending.current=false;setBusy(false);
  finishRecording();stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setPauseMessage('');paused.current=false;
 }
 function startRecorder(){
  const media=stream.current,id=session.current;if(!media)return;
  if(typeof MediaRecorder==='undefined'){setNotice('이 브라우저에서는 영상 없이 사진을 모아요.');return;}
  try{
   const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
   const rec=new MediaRecorder(media,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:1_800_000});const parts:Blob[]=[];let bytes=0;
   rec.ondataavailable=e=>{if(e.data.size&&session.current===id){parts.push(e.data);bytes+=e.data.size;if(bytes>SESSION_LIMITS.videoBytes&&rec.state!=='inactive'){log('video-limit','영상 용량 한도: 영상만 종료, 사진 수집 유지');setNotice('영상 저장 한도에 도달했어요. 사진 수집은 계속됩니다.');finishRecording();}}};
   rec.onstop=()=>{
    if(!live.current||session.current!==id)return;
    if(parts.length){const b=new Blob(parts,{type:rec.mimeType});setClip(b);if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(b);setClipURL(url.current);}
    setRecording(false);setFinalizing(false);
    if(capturePhase.current==='capture'){log('recorder-stopped','영상 녹화 종료. 사진 수집 유지.');setNotice('영상 녹화가 멈췄어요. 모은 영상은 보존하고 사진은 계속 모아요.');}
   };
   rec.onerror=()=>{if(live.current&&session.current===id){log('recorder-error','영상 녹화 오류. 사진 수집 유지.');setNotice('영상 녹화에 문제가 있어요. 사진 수집은 계속됩니다.');finishRecording();}};
   recorder.current=rec;rec.start(1000);setRecording(true);
  }catch{log('recorder-unavailable','사진만 수집');setNotice('영상 녹화를 시작하지 못했어요. 사진은 계속 모아요.');setRecording(false);}
 }
 async function begin(){
  if(opening)return;setDemo(false);const id=++session.current;setOpening(true);setError('');
  try{
   const c=await connection();if(!c.configured)throw new Error('AI 연결을 확인해주세요.');
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:720},height:{ideal:1280}},audio:false});
   if(!live.current||id!==session.current){media.getTracks().forEach(t=>t.stop());return;}
   stream.current=media;recorder.current=null;saved.current=[];qualityLog.current=[];events.current=[];setCaptureEvents([]);setCallLimit(false);started.current=0;updateSupplements([]);pending.current=false;paused.current=false;setPauseMessage('');setNotice('');setSelected([]);setHistory([]);setReviewed(false);setReviewSuggested(false);setSeconds(0);setClip(null);setClipURL('');setFinalizing(false);setRecording(false);setQualityHint('');setCameraReady(false);setFrontCandidate(null);setBaseline(null);baselineRef.current=null;stageRef.current='rotate';setStage('rotate');totalCalls.current=0;segmentCalls.current=0;
   if(url.current)URL.revokeObjectURL(url.current);url.current='';watchCamera(media,id);movePhase('align');setCameraVersion(v=>v+1);
  }catch(e){if(live.current&&id===session.current)setError(e instanceof DOMException?'카메라 권한을 허용하고 다시 시작해주세요.':(e as Error).message);}finally{if(live.current&&id===session.current)setOpening(false);}
 }
 function takeFront(){
  const v=video.current,box=camera.current;if(!v||!box||!v.videoWidth||v.paused){setError('카메라가 준비되면 다시 눌러주세요.');return;}
  const f=sample(v);if(f.quality.issues.length){setError(f.quality.issues[0]);return;}
  setError('');setFrontCandidate(f);
 }
 function confirmFront(){
  if(!frontCandidate||paused.current)return;
  baselineRef.current=frontCandidate;setBaseline(frontCandidate);directionRef.current=direction;setFrontCandidate(null);
  started.current=performance.now();segmentStart.current=started.current;log('front-confirmed',`사용자가 기준 정면과 사진 위쪽을 확인함. 회전 ${direction}`);
  // Keep the user's reference even if automatic selection/network fails immediately afterwards.
  const entry:Evidence={...frontCandidate,at:0,kept:true,latencyMs:0,observation:{usable:true,sameProduct:'no_reference',addsInformation:true,shape:'unknown',description:'사용자가 지정한 기준 정면 · AI 검증 전',newDetails:[],visibleGaps:[],action:'rotate',guidance:rotationInstruction(direction)}};
  saved.current=[entry];setSelected([entry]);setHistory([entry]);movePhase('capture');startRecorder();
 }
 async function resumeCapture(){
  if(opening||totalCalls.current>=SESSION_LIMITS.totalCalls)return;setOpening(true);const resumeEpoch=++requestEpoch.current;const resumeSession=session.current;
  try{
   if(!navigator.onLine)throw new Error('인터넷 연결을 먼저 확인해주세요.');
   const c=await connection();if(requestEpoch.current!==resumeEpoch)return;if(!c.configured)throw new Error('AI 연결이 준비되지 않았어요. 잠시 후 다시 시도해주세요.');
   if(!stream.current?.getVideoTracks().some(t=>t.readyState==='live'&&!t.muted)){
    finishRecording();stream.current?.getTracks().forEach(t=>t.stop());
    const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:720},height:{ideal:1280}},audio:false});
    if(!live.current||requestEpoch.current!==resumeEpoch||session.current!==resumeSession||!['align','capture'].includes(capturePhase.current)){media.getTracks().forEach(t=>t.stop());return;}
    stream.current=media;watchCamera(media,session.current);if(video.current)video.current.srcObject=media;setCameraVersion(v=>v+1);setNotice('카메라를 다시 연결했어요. 이후에는 사진을 모읍니다.');
   }
   await video.current?.play();
   if(!live.current||requestEpoch.current!==resumeEpoch||session.current!==resumeSession||!['align','capture'].includes(capturePhase.current))return;
   if(recorder.current?.state==='paused')try{recorder.current.resume();}catch{finishRecording();setNotice('영상 재개 대신 사진을 계속 모아요.');}
   const now=performance.now();if(started.current)started.current+=now-pauseAt.current;
   segmentStart.current=now;segmentCalls.current=0;paused.current=false;setPauseMessage('');setError('');log('user-resume','사용자가 계속 촬영 선택');
  }catch(e){setPauseMessage((e as Error).message||'카메라를 다시 연결하지 못했어요.');}finally{setOpening(false);}
 }
 useEffect(()=>{
  if(!['align','capture'].includes(phase)||!video.current)return;
  if(video.current.srcObject!==stream.current)video.current.srcObject=stream.current;
  void video.current.play().catch(()=>pauseRef.current('video-play','카메라 미리보기를 시작하지 못했어요. 계속 촬영을 눌러주세요.'));
 },[phase,cameraVersion]);
 useEffect(()=>{
  if(phase!=='capture')return;const id=session.current;
  let previous:{quality:Quality;at:number}|null=null,motion:MotionState|null=null,candidate:Frame|null=null,lastCall=-ORBIT_POLICY.intervalMs,lastLog=-1000,blurSince:number|null=null,blurLastAt=0,blurRecorded=false;
  const timer=window.setInterval(()=>{
   if(paused.current){previous=null;motion=null;candidate=null;return;}
   const elapsed=performance.now()-started.current;setSeconds(Math.floor(elapsed/1000));
   if(performance.now()-segmentStart.current>=SESSION_LIMITS.segmentSeconds*1000){pauseRef.current('time-limit','90초 동안 촬영했어요. 잠시 쉬거나 계속 촬영할 수 있어요.');return;}
   const v=video.current,box=camera.current;if(!v?.videoWidth||v.paused||!box||box.clientWidth<1||box.clientHeight<1)return;
   const f=sample(v);f.at=elapsed;const q=continuousQuality(f.quality,elapsed,previous);const feedback=motionFeedback(f.quality,elapsed,previous,motion);motion=feedback.state;setSpeed(feedback.message);previous={quality:f.quality,at:elapsed};setQualityHint(q.reason);
   if(localBlur(f.quality)){
    if(blurSince===null||elapsed-blurLastAt>SUPPLEMENT_POLICY.maxSampleGapMs){blurSince=elapsed;blurRecorded=false;}
    blurLastAt=elapsed;
    if(!blurRecorded&&elapsed-blurSince>=SUPPLEMENT_POLICY.blurDurationMs){updateSupplements(openSupplement(supplementRef.current,'blurred',f,'위치 확인이 필요한 장면','선명한 경계가 부족해요. 무늬가 적은 제품일 수도 있어요.','local-quality'));blurRecorded=true;setReviewSuggested(false);}
   }else{blurSince=null;blurRecorded=false;}
   if(!q.usable)candidate=null;
   if(elapsed-lastLog>=1000){qualityLog.current.push({at:elapsed,brightness:f.quality.brightness,sharpness:f.quality.sharpness,...q,speed:feedback.level});lastLog=elapsed;}
   if(candidate&&elapsed-candidate.at>1500)candidate=null;
   if(q.usable&&(!candidate||f.quality.sharpness>=candidate.quality.sharpness))candidate=f;
   if(pending.current||!q.usable||!candidate||elapsed-lastCall<ORBIT_POLICY.intervalMs)return;
   if(segmentCalls.current>=SESSION_LIMITS.segmentCalls||totalCalls.current>=SESSION_LIMITS.totalCalls){pauseRef.current('analysis-limit',totalCalls.current>=SESSION_LIMITS.totalCalls?'이번 촬영의 분석 한도에 도달했어요. 모은 자료를 확인해주세요.':'이번 구간의 분석을 마쳤어요. 계속 촬영하거나 모은 자료를 확인하세요.');return;}
   const frame=candidate;const nearest=Math.min(...saved.current.map(e=>duplicateDistance(e.quality.fingerprint,frame.quality.fingerprint)));
   const target=stageRef.current==='supplement'?nextSupplement(supplementRef.current):null;
   if(!target&&totalCalls.current>0&&nearest<ORBIT_POLICY.noveltyDistance&&elapsed-lastCall<ORBIT_POLICY.revisitMs)return;
   candidate=null;lastCall=elapsed;segmentCalls.current++;totalCalls.current++;pending.current=true;setBusy(true);const controller=new AbortController();abort.current=controller;const epoch=++requestEpoch.current;
   const refs=saved.current.slice(1).length>3?saved.current.slice(-3):saved.current.slice(1);
   void(async()=>{try{
    const r=await fetch('/api/capture/observe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({frame:frame.image,baseline:{frame:baselineRef.current!.image,direction:directionRef.current,stage:stageRef.current},references:refs.map(e=>({frame:e.image,description:e.observation.description})),...(target?{target:{id:target.id,kind:target.kind,region:target.region,reason:target.reason,frame:target.anchor.image}}:{})}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(26_000)])});const data=await r.json();if(!r.ok)throw new Error(data.error||`AI 연결 오류 (${r.status})`);
    if(!live.current||session.current!==id||capturePhase.current!=='capture'||paused.current||requestEpoch.current!==epoch)return;
    const observation=observationSchema.parse(data.observation);const result=applySupplementObservation(supplementRef.current,frame,observation,target?.id??null,true);updateSupplements(result.tasks);
    const kept=keepObservation(observation,true)||Boolean(result.improvedId);const entry:Evidence={...frame,observation,kept,latencyMs:data.latencyMs};setHistory(p=>[...p,entry]);
    if(kept){saved.current=[...saved.current,entry];setSelected([...saved.current]);}
    setReviewSuggested(observation.action==='review'&&saved.current.length>=2&&!result.tasks.some(t=>t.status!=='improved'));
   }catch(e){if(live.current&&session.current===id&&capturePhase.current==='capture'&&!controller.signal.aborted&&requestEpoch.current===epoch){const timeout=(e as Error).name==='TimeoutError';pauseRef.current(timeout?'analysis-timeout':'analysis-error',timeout?'AI 응답이 늦어 잠시 멈췄어요. 모은 사진은 그대로예요.':`AI 연결을 잠시 멈췄어요. ${(e as Error).message}`);}}
   finally{if(live.current&&session.current===id&&requestEpoch.current===epoch){pending.current=false;setBusy(false);}}})();
  },250);return()=>clearInterval(timer);
 },[phase]);
 async function continueToPrompt(){
  setSaving(true);setError('');
  try{
   const packet=createHandoff({id:crypto.randomUUID(),createdAt:new Date().toISOString(),reviewed,demo,frames:selected.map(e=>({image:e.image,at:e.at,description:e.observation.description})),unresolved:supplements.filter(t=>t.status!=='improved').map(t=>`${t.region}: ${t.reason}`)});
   await saveHandoff(packet);router.push(`/prompt?capture=${packet.id}`);
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
  if(baseline)files.push({name:'baseline-front.jpg',data:bytes(baseline.image)});
  const manifest={version:7,baseline:baseline?{file:'baseline-front.jpg',up:'image-top',direction}:null,captureEvents:events.current,sessionLimits:SESSION_LIMITS,supplementPolicy:SUPPLEMENT_POLICY,supplements:supplementRecords,unresolvedSupplementCount:unresolved,mode:demo?'illustrative-demo':'continuous-information-selection',policy:ORBIT_POLICY,qualityTimeline:qualityLog.current,reviewConfirmed:reviewed,coverage:'not-certified',evidence:history.map((item,i)=>{const e={...item,image:undefined};return({...e,file:`evidence/frame-${i+1}.jpg`,selectedByUser:selected.some(s=>s.at===e.at)});}),limits:['Supplement classifications and same-region comparisons are model estimates, not geometric tracking or full coverage. Local low sharpness is not confirmed blur.','Sampled frames, not full-video reasoning or 3D reconstruction.','No fixed face quota. New information and sufficiency are model estimates.','Quality thresholds are provisional and measured on center crop.','Only first and three latest selected frames are model context after four selections.']};
  files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});download(new Blob([new Uint8Array(createZip(files))],{type:'application/zip'}),'frame-continuous-capture.zip');
 }catch{setError('자료 저장에 실패했어요. 영상부터 따로 저장해주세요.');}finally{setSaving(false);}}
 return <main className={s.app} lang="ko">
 {(phase==='align'||phase==='capture')?<section className={s.capture}>
  <header className={s.captureHeader}><strong>{phase==='align'?'기준 정면 잡기':stage==='rotate'?'한 방향으로 회전':'부족한 부분 보충'}</strong><span>{phase==='capture'?(pauseMessage?'일시정지':recording?'녹화 중':'사진 수집 중')+' · '+seconds+'초':'사진 위쪽 = 제품 위쪽'}</span></header>
  <div className={s.camera} ref={camera}>
   <video ref={video} autoPlay playsInline muted onLoadedData={()=>setCameraReady(true)} onPause={()=>{if(capturePhase.current==='capture'&&!paused.current)pauseRef.current('preview-paused','카메라 미리보기가 멈췄어요. 계속 촬영을 눌러주세요.');}} onError={()=>pauseRef.current('preview-error','카메라 미리보기에 문제가 있어요. 다시 연결해주세요.')}/>
   {frontCandidate&&<img className={s.frontPreview} src={frontCandidate.image} alt="기준 정면으로 지정할 사진"/>}
   {phase==='align'&&<div className={s.frameGuide} aria-hidden="true"/>}
   {baseline&&<div className={s.baseline}><MarkedPhoto image={baseline.image} alt="기준 정면 · 사진 위쪽이 제품 위쪽"/><span>기준 정면 · 위쪽 유지</span></div>}
   {!pauseMessage&&<div className={s.overlay}>
    {phase==='align'?<p role="status">{frontCandidate?'이 사진을 기준 정면으로 사용할까요?':'앞으로 삼을 면을 카메라에 보여주세요.'}</p>:<>
     {stage==='rotate'&&<svg className={s.rotationArrow} viewBox="0 0 120 32" role="img" aria-label={`기준 정면을 화면 ${direction==='right'?'오른쪽':'왼쪽'}으로 회전`} style={{transform:direction==='left'?'scaleX(-1)':undefined}}><path d="M8 9C30 29 82 29 110 12M91 9l20 2-5 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
     <p>{stage==='rotate'?rotationInstruction(direction):availableSupplement?supplementGuidance(availableSupplement):'기준 정면으로 돌아와 위·아래를 조금씩 기울여 보여주세요.'}</p>
     <p className={s.speed} role="status">{qualityHint||(stage==='rotate'?speed:availableSupplement?'표시한 부위가 보이면 잠깐 유지해주세요.':'위·아래가 보이도록 천천히 기울여주세요.')}</p>
    </>}
   </div>}
   {enlarged&&<div className={s.photoDetail} role="dialog" aria-modal="false" aria-label="보충할 부위 확대 사진"><MarkedPhoto image={enlarged.anchor.image} box={enlarged.box} alt="문제가 발견된 사진의 표시 부위"/><p>{enlarged.box?'표시한 부분을 카메라에 보여주세요.':'위치를 확신하지 못해 표시하지 않았어요.'}</p><button onClick={()=>setEnlarged(null)}>사진 닫기</button></div>}
  </div>
  <div className={s.captureBottom}>
   {pauseMessage?<div className={s.pausePanel} role="alert"><strong>잠시 멈췄어요</strong><p>{pauseMessage}</p>{!callLimit&&<button className={s.primary} disabled={opening} onClick={()=>void resumeCapture()}>{opening?'연결 확인 중…':'계속 촬영'}</button>}</div>:phase==='align'?<>
    {error&&<p role="alert" className={s.inlineError}>{error}</p>}
    {frontCandidate?<><fieldset className={s.direction}><legend>기준 정면이 돌아갈 방향</legend>{(['right','left'] as const).map(d=><label key={d}><input type="radio" name="direction" value={d} checked={direction===d} onChange={()=>setDirection(d)}/>{d==='right'?'화면 오른쪽':'화면 왼쪽'}</label>)}</fieldset><button className={s.primary} onClick={confirmFront}>이 정면으로 촬영 시작</button><button className={s.textButton} onClick={()=>setFrontCandidate(null)}>기준 사진 다시 찍기</button></>:<><p>정면이 애매하면 편한 면을 고르세요. 사진의 위쪽도 기준으로 고정됩니다.</p><button className={s.primary} disabled={!cameraReady} onClick={takeFront}>기준 정면 찍기</button></>}
   </>:<>
    {stage==='supplement'&&availableSupplement&&<div className={s.supplementPrompt}>
     <button className={s.photoButton} aria-label="보충할 부위 사진 크게 보기" onClick={()=>setEnlarged(availableSupplement)}><MarkedPhoto image={availableSupplement.anchor.image} box={availableSupplement.box} alt="보충할 부분이 표시된 당시 사진"/></button>
     <div><strong>{SUPPLEMENT_LABELS[availableSupplement.kind]}</strong><span>{availableSupplement.box?'사진 표시 부분 · 눌러서 확대':'위치 미확인 · 사진 전체 참고'}</span><button onClick={()=>{updateSupplements(deferSupplement(supplementRef.current,availableSupplement.id,performance.now()-started.current));setReviewSuggested(false);}}>이 부분은 건너뛰기</button></div>
    </div>}
    <div className={s.captureStatus}><span>{selected.length}장 보관 · {busy?'사진 분석 중':unresolved?`보충 후보 ${unresolved}건`:reviewSuggested?'자료를 확인해도 좋아요':'새로운 장면을 모으고 있어요'}</span><button className={s.textButton} onClick={()=>{const next=stage==='rotate'?'supplement':'rotate';stageRef.current=next;setStage(next);log('user-stage',next);}}>{stage==='rotate'?'한 바퀴 돌렸어요 · 보충하기':'같은 방향 회전으로 돌아가기'}</button></div>
    {notice&&<p className={s.inlineError} role="status">{notice}</p>}
   </>}
   {phase==='capture'?<button className={pauseMessage?s.secondary:s.primary} disabled={opening} onClick={stop}>촬영 마치고 확인</button>:<button className={s.textButton} onClick={()=>{capturePhase.current='intro';requestEpoch.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;paused.current=false;setPauseMessage('');setError('');movePhase('intro');}}>촬영 취소</button>}
  </div>
 </section>:<div className={s.shell}>
  <StudioNav active="capture" />
  {error&&<p role="alert" className={s.error}>{error}</p>}
  {phase==='intro'?<div className={s.introLayout}><section className={s.intro}><h1>제품 촬영</h1><p>기준 정면을 정하고, 한 방향으로 돌려주세요.</p><ol className={s.instructions}><li>앞으로 삼을 면과 위쪽을 먼저 정하세요.</li><li>화살표 방향으로 돌리며 속도 안내를 따라주세요.</li><li>표시된 부족한 부분을 보충한 뒤 직접 종료하세요.</li></ol>
   <div className={s.startPanel}><div className={s.connection}><span>{config?.configured?'촬영 준비됨':'AI 연결 확인 필요'}</span>{!config?.configured&&<button onClick={()=>{setError('');void connection().catch(e=>setError(e.message));}}>다시 확인</button>}</div>
    <button className={s.primary} disabled={opening||!config?.configured} onClick={()=>void begin()}>{opening?'카메라 여는 중…':'촬영 시작'}</button>
    <button className={s.secondary} disabled={opening} onClick={()=>void tryExample()}>예시 사진으로 연결 체험</button><p className={s.note}>90초마다 잠시 쉬기 · 종료는 직접 선택 · 사진은 OpenAI로 전송됩니다.</p>
   </div><Link className={s.directLink} href="/prompt">사진 직접 올리기</Link></section><figure className={s.heroImage}><img src="/studio/scene.jpg" alt="가상 세럼의 제품 촬영 연출 예시"/><figcaption><span>가상 제품 · AI 연출 예시</span></figcaption></figure></div>:<section className={s.review}>
   <h1>사진 확인</h1>{demo&&<p className={s.demoNote}>가상 제품 예시</p>}<p>사용할 사진을 확인하세요. 불필요한 장면은 제외할 수 있어요.</p>
   {finalizing?<p role="status">영상을 마무리하고 있어요…</p>:clipURL?<div className={s.recording}><video src={clipURL} controls playsInline/><button onClick={()=>clip&&download(clip,clip.type.includes('mp4')?'capture.mp4':'capture.webm')}>영상만 저장</button></div>:!demo?<p className={s.note}>녹화 없이 선별 사진만 저장됩니다.</p>:null}
   {supplements.length>0&&<section className={s.supplementReview} aria-label="보충 촬영 기록">
    <h2>보충 촬영 확인</h2><p>{unresolved?`아직 확인하지 못한 항목 ${unresolved}건이 있어요. 부분 자료로 저장할 수 있어요.`:'각 항목의 보충 장면을 모았어요. 실제로 개선됐는지 사진을 확인해주세요.'}</p>
    {supplements.map(t=><article key={t.id}>
     <MarkedPhoto image={t.anchor.image} box={t.box} alt={`${SUPPLEMENT_LABELS[t.kind]} 기준 장면`}/>
     <div><strong>{SUPPLEMENT_LABELS[t.kind]} · {t.status==='improved'?'보충 장면 확보 (AI 추정)':t.status==='deferred'?'보류 · 미확보':'확인 필요'}</strong><p>{t.region}</p><small>{t.reason}</small>
      {t.support&&<a href={t.support.image} download={`${t.id}-support.jpg`}>보충 사진 보기·저장<img src={t.support.image} alt={`${t.region} 보충 장면`}/></a>}
     </div>
    </article>)}
    <p className={s.note}>AI가 찾은 보충 후보입니다. 사진으로 확인해주세요.</p>
   </section>}
   {selected.length?<div className={s.scenes}>{selected.map(e=><article key={e.at}><a href={e.image} download={`scene-${Math.round(e.at)}.jpg`}><img src={e.image} alt={e.observation.description}/></a><div><p>{e.observation.description}</p><small>{(e.at/1000).toFixed(1)}초</small><button onClick={()=>{setSelected(p=>p.filter(x=>x.at!==e.at));updateSupplements(excludeSupplementEvidence(supplementRef.current,e.at));setReviewed(false);}}>이 장면 제외</button></div></article>)}</div>:<p className={s.empty}>자동 선별한 장면이 없어요. 녹화 영상이 있다면 먼저 저장하고 조명과 속도를 바꿔 다시 촬영해주세요.</p>}
   <label className={s.check}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>선별된 장면과 부족한 부분을 확인했어요.</label>
   <button className={s.primary} disabled={!reviewed||saving||finalizing||!selected.length} onClick={()=>void continueToPrompt()}>{saving?'사진을 연결하고 있어요…':'이 사진으로 연출 기획하기'}</button><button className={s.secondary} disabled={!reviewed||saving||finalizing||(!history.length&&!clip)} onClick={()=>void exportAll()}>{saving?'저장 준비 중…':'촬영 자료 저장'}</button><button className={s.secondary} disabled={finalizing||saving} onClick={()=>{if(window.confirm('현재 자료를 저장했나요? 다시 촬영하면 현재 자료가 사라져요.'))void begin();}}>다시 촬영</button>
   <details className={s.details}><summary>선별 기록 · {history.length}건</summary>{history.map((e,i)=><p key={i}>{(e.at/1000).toFixed(1)}초 · {e.kept?'선별':'제외'} · {e.observation.description}<br/>추가로 보인 정보: {e.observation.newDetails.join(', ')||'없음'}<br/>확인하지 못한 부분: {e.observation.visibleGaps.join(', ')||'모델이 지적한 부분 없음'}</p>)}</details>
   {captureEvents.length>0&&<details className={s.details}><summary>촬영 중 일어난 일</summary>{captureEvents.map((e,i)=><p key={i}>{Math.round(e.at/1000)}초 · {e.detail}</p>)}</details>}
   {clip&&<p className={s.note}>전체 영상이 필요하면 이동 전에 저장해주세요.</p>}
  </section>}
 </div>}
 </main>;
}
