'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { analyzePixels, duplicateDistance, type Quality } from '@/lib/capture/quality';
import { createZip } from '@/lib/capture/zip';
import s from './capture.module.css';
import c from './scan.module.css';

type Frame = { url:string; quality:Quality; at:number; width:number; height:number };
function inspect(canvas:HTMLCanvasElement) {
  const mini=document.createElement('canvas');mini.width=160;mini.height=160;
  const side=Math.min(canvas.width,canvas.height)*.72, ctx=mini.getContext('2d')!;
  ctx.drawImage(canvas,(canvas.width-side)/2,(canvas.height-side)/2,side,side,0,0,160,160);
  return analyzePixels(ctx.getImageData(0,0,160,160).data,160,160);
}
function saveBlob(blob:Blob,name:string) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000); }
export default function Scan() {
  const [phase,setPhase]=useState<'intro'|'scan'|'review'>('intro');
  const [running,setRunning]=useState(false),[opening,setOpening]=useState(false),[finalizing,setFinalizing]=useState(false);
  const [frames,setFrames]=useState<Frame[]>([]),[seconds,setSeconds]=useState(0),[status,setStatus]=useState('제품 앞면을 가운데 맞춰주세요.');
  const [error,setError]=useState(''),[recorded,setRecorded]=useState<Blob|null>(null),[recordURL,setRecordURL]=useState('');
  const [videoSupported,setVideoSupported]=useState(true),[exporting,setExporting]=useState(false);
  const [target,setTarget]=useState<3|6>(6),[roles,setRoles]=useState({front:-1,side:-1,oblique:-1});
  const [size,setSize]=useState({w:9,h:12});
  const video=useRef<HTMLVideoElement>(null),media=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null);
  const selected=useRef<Frame[]>([]),started=useRef(0),request=useRef(0),mounted=useRef(true);
  const finishRef=useRef<()=>void>(()=>{}), objectURL=useRef('');
  useEffect(()=>{const token=request,alive=mounted,record=recorder,stream=media,url=objectURL;alive.current=true;return()=>{alive.current=false;token.current++;if(record.current?.state==='recording')record.current.stop();stream.current?.getTracks().forEach(t=>t.stop());if(url.current)URL.revokeObjectURL(url.current);};},[]);
  function finish() {
    if(!media.current)return;
    if(recorder.current?.state==='recording'){setFinalizing(true);recorder.current.stop();}
    media.current.getTracks().forEach(t=>t.stop());media.current=null;setRunning(false);setPhase('review');
  }
  useEffect(()=>{finishRef.current=finish;});
  useEffect(()=>{
    if(!running||!video.current)return;
    video.current.srcObject=media.current;
    let prev:number[]|null=null,stable=0,lastSaved=-2000;
    const timer=window.setInterval(()=>{
      const elapsed=performance.now()-started.current;setSeconds(Math.floor(elapsed/1000));
      if(elapsed>=45000){finishRef.current();return;}
      const v=video.current;if(!v?.videoWidth||v.paused)return;
      const canvas=document.createElement('canvas');const scale=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);
      canvas.getContext('2d')!.drawImage(v,0,0,canvas.width,canvas.height);const q=inspect(canvas);
      const movement=prev?duplicateDistance(q.fingerprint,prev):Infinity;prev=q.fingerprint;
      if(q.issues.length){stable=0;setStatus(q.issues[0]);return;}
      stable=movement<.035?stable+1:0;
      if(stable<3){setStatus('좋아요. 그 위치에서 잠깐 멈춰주세요.');return;}
      const nearest=Math.min(...selected.current.map(f=>duplicateDistance(f.quality.fingerprint,q.fingerprint)));
      if(nearest<.045){setStatus('이 모습은 모았어요. 제품을 조금 더 돌려주세요.');return;}
      if(elapsed-lastSaved<1400)return;
      const frame={url:canvas.toDataURL('image/jpeg',.92),quality:q,at:elapsed,width:canvas.width,height:canvas.height};
      selected.current=[...selected.current,frame];setFrames([...selected.current]);lastSaved=elapsed;stable=0;
      setStatus('새로운 장면을 모았어요. 천천히 계속 돌려주세요.');
      if(selected.current.length>=target)finishRef.current();
    },250);
    return()=>clearInterval(timer);
  },[running,target]);
  async function begin() {
    const id=++request.current;setOpening(true);setError('');selected.current=[];setFrames([]);setRecorded(null);if(objectURL.current)URL.revokeObjectURL(objectURL.current);objectURL.current='';setRecordURL('');setRoles({front:-1,side:-1,oblique:-1});setSeconds(0);
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('카메라를 사용할 수 없어요. HTTPS 주소를 Safari 또는 Chrome에서 열어주세요.');
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(id!==request.current||!mounted.current){stream.getTracks().forEach(t=>t.stop());return;}
      media.current=stream;recorder.current=null;setVideoSupported(false);
      stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(mounted.current&&id===request.current&&media.current===stream){setError('카메라 연결이 끊겼어요. 지금까지 모은 영상과 사진을 확인해주세요.');finishRef.current();}}));
      if(typeof MediaRecorder!=='undefined'){
        const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
        try {
          const r=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:2500000}:{videoBitsPerSecond:2500000});const parts:Blob[]=[];let bytes=0;
          r.ondataavailable=e=>{if(e.data.size){parts.push(e.data);bytes+=e.data.size;if(bytes>20*1024*1024)finishRef.current();}};
          r.onstop=()=>{if(mounted.current&&id===request.current){if(media.current===stream){setError('녹화가 중단됐어요. 지금까지 모은 자료는 아래에서 확인할 수 있어요.');finishRef.current();}const blob=parts.length?new Blob(parts,{type:r.mimeType||mime||'video/webm'}):null;setRecorded(blob);if(blob){objectURL.current=URL.createObjectURL(blob);setRecordURL(objectURL.current);}setFinalizing(false);}};
          r.onerror=()=>{if(mounted.current){setError('영상 녹화 중 문제가 생겼어요. 수집된 사진은 확인할 수 있어요.');setFinalizing(false);finishRef.current();}};
          recorder.current=r;r.start(1000);setVideoSupported(true);
        }catch {setVideoSupported(false);}
      }
      started.current=performance.now();setPhase('scan');setRunning(true);setStatus('제품 앞면을 가운데 맞추고 잠시 멈춰주세요.');
    }catch(e){setError(e instanceof DOMException?'카메라 권한을 허용해주세요. 앱 안의 브라우저라면 Safari 또는 Chrome에서 다시 열어보세요.':(e as Error).message);}
    finally{if(mounted.current&&id===request.current)setOpening(false);}
  }
  const needed=target===3?['front'] as const:['front','side','oblique'] as const;
  const roleNames={front:'정면',side:'옆면',oblique:'사선'};
  const ready=needed.every(r=>roles[r]>=0)&&new Set(needed.map(r=>roles[r])).size===needed.length;
  async function exportPackage(){
    if(!ready)return;setExporting(true);
    try{
      const files=frames.map((f,i)=>({name:`candidates/frame-${i+1}.jpg`,data:Uint8Array.from(atob(f.url.split(',')[1]),x=>x.charCodeAt(0))}));
      for(const role of needed)files.push({name:`selected/${role}.jpg`,data:files[roles[role]].data});
      if(recorded)files.push({name:recorded.type.includes('mp4')?'capture.mp4':'capture.webm',data:new Uint8Array(await recorded.arrayBuffer())});
      const manifest={version:2,mode:'continuous-guided-capture',preset:target===3?'front':'front-side',coverageVerified:false,viewVerification:'manual-after-recording',roles,videoMime:recorded?.type??null,frames:frames.map((f,i)=>({at:f.at,width:f.width,height:f.height,quality:f.quality,file:`candidates/frame-${i+1}.jpg`})) ,limitations:['품질과 화면 변화 기반 후보 선별. 각도·동일 상품·전체 면 확보 자동 판정 아님.','사람이 촬영 결과에서 필요한 면을 선택함.','사진 최대 긴 변 1280px.','광고 생성 정확성 미검증.']};
      files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});saveBlob(new Blob([new Uint8Array(createZip(files))],{type:'application/zip'}),'frame-capture.zip');
    }catch{setError('내보내기에 실패했어요. 영상만 먼저 저장한 뒤 다시 시도해주세요.');}finally{setExporting(false);}
  }
  const progress=Math.min(1,frames.length/target);
  return <main className={s.app} lang="ko"><header className={s.header}><a href="/capture" className={s.brand}>FRAME<span>제품 촬영 스튜디오</span></a><span className={s.mode}>연속 촬영 · 기본 프로토타입</span></header><div className={`${s.shell} ${c.shell}`}>
    {phase==='intro'?<section className={c.intro}><div className={c.orbit} aria-hidden="true"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="77" fill="none" stroke="#d1ddd2" strokeWidth="4" strokeDasharray="3 9"/><path d="m64 63 38-10 25 17v50l-38 13-25-17Z M64 63l25 18 38-11 M89 81v52" fill="none" stroke="#1b604b" strokeWidth="2"/></svg></div><h1>천천히 돌리면,<br/>필요한 모습이 모여요.</h1><p className={s.lead}>카메라를 켜고 제품을 천천히 돌려주세요.<br/>잠깐 멈출 때마다 선명한 새 장면을 자동으로 모아요.</p><div className={c.presets}><button aria-pressed={target===3} onClick={()=>setTarget(3)}>정면 소개<small>앞면 후보 3장 수집</small></button><button aria-pressed={target===6} onClick={()=>setTarget(6)}>입체적인 소개<small>여러 모습 후보 6장 수집</small></button></div><button className={s.primary} disabled={opening} onClick={begin}>{opening?'카메라 여는 중…':'연속 촬영 시작'}</button><p className={c.privacy}>소리 없이 최대 45초 · 사진과 영상은 이 기기에서만 처리<br/>앞면과 옆면이 다른 불투명 상자를 준비해주세요.</p><p className={s.note}>정확한 각도 인식은 아직 연결되지 않았어요.<br/>촬영 후 필요한 면을 직접 확인해요.</p></section>:phase==='scan'?<section className={c.scan}>
      <div className={c.scanTitle}><h1>{frames.length===0?'앞면을 맞춰주세요':target===3?'앞면을 조금씩 기울여주세요':frames.length<3?'천천히 옆으로 돌려주세요':'앞면과 옆면을 함께 보여주세요'}</h1><span>{seconds}s / 45s</span></div>
      <div className={c.camera} style={{aspectRatio:`${size.w}/${size.h}`}}><video ref={video} autoPlay playsInline muted onLoadedMetadata={e=>setSize({w:e.currentTarget.videoWidth,h:e.currentTarget.videoHeight})}/><div className={c.ring} style={{width:`${82*Math.min(size.w,size.h)/size.w}%`,height:`${82*Math.min(size.w,size.h)/size.h}%`}}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100"/><circle cx="50" cy="50" r="47" pathLength="100" strokeDasharray={`${progress*100} 100`} className={c.fill}/></svg></div><div className={c.guide} style={{width:`${72*Math.min(size.w,size.h)/size.w}%`,height:`${72*Math.min(size.w,size.h)/size.h}%`}}/><span className={c.record}>{videoSupported?'영상 녹화 중':'프레임 수집 중'}</span></div>
      <p className={c.status} role="status">{status}</p><div className={c.count}><strong>{frames.length} / {target}</strong><span>서로 다른 모습 후보 · 각도 확인은 촬영 후</span></div><div className={c.strip}>{frames.map((f,i)=><img key={i} src={f.url} alt={`자동 수집 후보 ${i+1}`}/>)}</div><button className={s.secondary} onClick={finish}>여기까지 촬영하고 확인</button>{!videoSupported&&<p className={s.note}>이 브라우저는 영상 녹화를 지원하지 않아 사진 후보만 저장해요.</p>}
    </section>:<section className={c.review}><h1>{frames.length?'이제 필요한 면을 골라주세요.':'장면을 모으지 못했어요.'}</h1><p className={s.lead}>{frames.length?'촬영은 한 번에, 확인은 마지막에. 원본과 맞는 면을 골라주세요.':'밝은 곳에서 제품을 천천히 돌리고, 각 위치에서 잠깐 멈춰주세요.'}</p>
      {finalizing?<p role="status">영상을 마무리하고 있어요…</p>:recordURL?<div className={c.recording}><video src={recordURL} controls playsInline/><button className={s.secondary} onClick={()=>recorded&&saveBlob(recorded,recorded.type.includes('mp4')?'capture.mp4':'capture.webm')}>촬영 영상 저장</button></div>:<p className={s.note}>저장된 영상이 없어요. 수집한 사진 후보를 확인해주세요.</p>}
      {frames.length>0&&<><div className={c.candidates}>{frames.map((f,i)=><figure key={i}><img src={f.url} alt={`후보 ${i+1}`} /><figcaption>후보 {i+1} · {(f.at/1000).toFixed(1)}초</figcaption></figure>)}</div><div className={c.roleSelect}>{needed.map(role=><label key={role}>{roleNames[role]}<select value={roles[role]} onChange={e=>setRoles({...roles,[role]:Number(e.target.value)})}><option value={-1}>맞는 사진을 선택하세요</option>{frames.map((_,i)=><option key={i} value={i}>후보 {i+1}</option>)}</select></label>)}</div><p className={s.note}>각 항목에 서로 다른 사진을 선택해주세요. 필요한 면이 없다면 다시 촬영해주세요.</p><button className={s.primary} disabled={!ready||finalizing||exporting} onClick={exportPackage}>{exporting?'파일 묶는 중…':'영상 + 사진 묶음 다운로드'}</button></>}
      <button className={s.secondary} disabled={opening||finalizing||exporting} onClick={()=>{if(window.confirm('현재 촬영을 지우고 다시 시작할까요? 필요한 영상은 먼저 저장해주세요.'))void begin();}}>다시 촬영</button><p className={s.note}>후보 개수는 제품 이해도나 각도별 확보율을 뜻하지 않아요. 품질·화면 변화 검사로 선별한 사진이며, 실제 면은 직접 확인해야 해요.</p>
    </section>}{error&&<p className={s.error} role="alert">{error}</p>}<footer className={s.footer}><span>필요한 모습은 놓치지 않도록.</span><span>새로고침하면 촬영 자료가 사라져요.</span></footer></div></main>;
}
