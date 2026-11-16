'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { analyzePixels, duplicateDistance, requiredViews, type Quality, type View } from '@/lib/capture/quality';
import { createZip } from '@/lib/capture/zip';
import s from './capture.module.css';

type Photo = { url: string; quality: Quality; width: number; height: number; source: string; time: string };
const labels: Record<View, string> = { front: '정면', side: '옆면', oblique: '사선' };
const hints: Record<View, string> = { front: '앞면 전체가 보이도록 제품을 놓아주세요.', side: '앞면에서 한쪽으로 돌려, 옆면 전체를 보여주세요.', oblique: '앞면과 방금 찍은 옆면이 함께 보이도록 살짝 돌려주세요.' };
function Box({ angle = false }: { angle?: boolean }) { return <svg viewBox="0 0 180 150" fill="none" aria-hidden="true"><path d={angle ? 'M42 40 106 25 142 45 142 115 78 134 42 110Z' : 'M52 26H128V128H52Z'} fill="#e7eee8" stroke="currentColor" strokeWidth="2"/>{angle ? <path d="M42 40 78 61 142 45M78 61V134" stroke="currentColor" strokeWidth="2"/> : <path d="M69 50H111M69 60H103M69 99H111" stroke="currentColor" strokeWidth="2"/>}<path d="M30 136H150" stroke="currentColor" opacity=".3"/></svg>; }
function measure(canvas: HTMLCanvasElement) {
  const small = document.createElement('canvas'); small.width = 160; small.height = 160;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  // Center 72% matches the visible guide. No object segmentation is implied.
  const side = Math.min(canvas.width, canvas.height) * .72;
  ctx.drawImage(canvas, (canvas.width-side)/2, (canvas.height-side)/2, side, side, 0, 0, 160, 160);
  return analyzePixels(ctx.getImageData(0, 0, 160, 160).data, 160, 160);
}
export default function Capture() {
  const [preset, setPreset] = useState<'front'|'angle'>('angle');
  const [phase, setPhase] = useState<'setup'|'capture'|'review'>('setup');
  const [active, setActive] = useState<View>('front');
  const [photos, setPhotos] = useState<Partial<Record<View, Photo>>>({});
  const [candidate, setCandidate] = useState<Photo|null>(null);
  const [quality, setQuality] = useState<Quality|null>(null);
  const [videoSize, setVideoSize] = useState({w:16,h:9});
  const [camera, setCamera] = useState(false), [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream|null>(null);
  const input = useRef<HTMLInputElement>(null), generation = useRef(0);
  const started = useRef(''), log = useRef<{time:string; event:string; view?:View}[]>([]);
  const views = requiredViews(preset), count = views.filter(v => photos[v]).length;
  const addLog = (event:string, view?:View) => log.current.push({ time:new Date().toISOString(), event, view });
  const stop = () => { generation.current++; stream.current?.getTracks().forEach(t=>t.stop()); stream.current=null; setCamera(false); setStarting(false); };
  useEffect(() => { const token = generation; const media = stream; return () => { token.current++; media.current?.getTracks().forEach(t=>t.stop()); }; }, []);
  useEffect(() => {
    if (!camera || !video.current) return;
    video.current.srcObject = stream.current;
    const timer = window.setInterval(() => {
      const v=video.current; if (!v?.videoWidth || v.paused) return;
      const c=document.createElement('canvas'); c.width=320; c.height=Math.round(320*v.videoHeight/v.videoWidth);
      c.getContext('2d')!.drawImage(v,0,0,c.width,c.height); setQuality(measure(c));
    }, 350);
    return () => clearInterval(timer);
  }, [camera]);
  async function startCamera() {
    setError(''); setStarting(true); const id=++generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요. 사진 업로드로 계속할 수 있어요.');
      const media=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080} }, audio:false });
      if (id!==generation.current) { media.getTracks().forEach(t=>t.stop()); return; }
      stream.current=media; setCamera(true); addLog('camera_started');
    } catch(e) { if (id===generation.current) setError(e instanceof DOMException ? '카메라를 열지 못했어요. 브라우저 권한을 확인하거나 사진을 업로드해주세요.' : (e as Error).message); }
    finally { if(id===generation.current) setStarting(false); }
  }
  function prepare(c:HTMLCanvasElement, source:string) {
    const q=measure(c); setQuality(q); setConfirmed(false); setError(''); setNotice('');
    setCandidate({url:c.toDataURL('image/jpeg',.94), quality:q, width:c.width, height:c.height, source, time:new Date().toISOString()});
    addLog('candidate_created',active);
  }
  function shoot() {
    const v=video.current; if(!v?.videoWidth) return;
    const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext('2d')!.drawImage(v,0,0); prepare(c,'camera'); stop();
  }
  async function upload(file?:File) {
    if(!file) return; setError(''); setBusy(true); stop(); const id=++generation.current;
    if(file.size>20*1024*1024) { setError('20MB 이하 사진을 선택해주세요.'); setBusy(false); return; }
    const url=URL.createObjectURL(file);
    try {
      const image=new Image(); image.src=url; await image.decode();
      if(id!==generation.current) return;
      const scale=Math.min(1,2560/Math.max(image.width,image.height)); const c=document.createElement('canvas');
      c.width=Math.round(image.width*scale); c.height=Math.round(image.height*scale);
      c.getContext('2d')!.drawImage(image,0,0,c.width,c.height); prepare(c,'upload');
    } catch { if(id===generation.current) setError('사진을 읽지 못했어요. JPG, PNG 또는 WebP 사진을 선택해주세요.'); }
    finally { URL.revokeObjectURL(url); if(id===generation.current) setBusy(false); }
  }
  const duplicate = candidate ? views.find(v => v!==active && photos[v] && duplicateDistance(candidate.quality.fingerprint, photos[v]!.quality.fingerprint)<.018) : undefined;
  const problems = candidate?.quality.issues ?? [];
  function save() {
    if(!candidate || !confirmed || problems.length || duplicate) return;
    const next={...photos,[active]:candidate}; setPhotos(next); addLog('saved_manual_view_confirmation',active); setCandidate(null); setConfirmed(false); setQuality(null);
    const remaining=views.find(v=>!next[v]);
    if(remaining) { setActive(remaining); setNotice(`${labels[active]} 사진을 확보했어요. 다음 면을 촬영해주세요.`); }
    else { stop(); setPhase('review'); }
  }
  function download() {
    const files=views.map(v=>({name:`${v}.jpg`,data:Uint8Array.from(atob(photos[v]!.url.split(',')[1]), c=>c.charCodeAt(0))}));
    const manifest={version:1,preset,startedAt:started.current,exportedAt:new Date().toISOString(),viewVerification:'manual',qualityScope:'center-guide-region-heuristic',limitations:['자동 면 판정 없음','제품 전체·가림 여부는 사용자 확인','생성 품질 개선 미검증'],photos:views.map(v=>({view:v,file:`${v}.jpg`,...Object.fromEntries(Object.entries(photos[v]!).filter(([k])=>k!=='url'))})),events:log.current};
    files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
    const zip=createZip(files), url=URL.createObjectURL(new Blob([new Uint8Array(zip)],{type:'application/zip'}));
    const a=document.createElement('a'); a.href=url; a.download=`capture-${manifest.exportedAt.replaceAll(":","-")}.zip`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000); setNotice('사진과 촬영 기록을 ZIP으로 내보냈어요.');
  }
  function retake(v:View) { stop(); setBusy(false); setActive(v); setCandidate(null); setConfirmed(false); setQuality(null); setError(''); setNotice('기존 사진은 새 사진을 저장할 때 교체돼요.'); setPhase('capture'); addLog('retake',v); }
  return <main className={s.app} lang="ko">
    <header className={s.header}><a href="/capture" className={s.brand}>FRAME<span>제품 촬영 스튜디오</span></a><span className={s.mode}>기본 프로토타입 · 면 수동 확인</span></header>
    <div className={s.shell}>
      <nav className={s.steps} aria-label="촬영 단계">{['연출 선택','사진 확보','확인 · 내보내기'].map((t,i)=><span key={t} aria-current={i===['setup','capture','review'].indexOf(phase)?'step':undefined}><b>{i+1}</b>{t}</span>)}</nav>
      {phase==='setup' ? <section className={s.setup}>
        <div><h1>어떤 모습을<br/>보여주고 싶나요?</h1><p className={s.lead}>광고에 필요한 면만, 한 장씩.<br/>촬영 안내를 따라 제품의 모습을 확보하세요.</p></div>
        <div className={s.choices} role="group" aria-label="광고 연출">{(['front','angle'] as const).map(p=><button className={`${s.choice} ${preset===p?s.selected:''}`} aria-pressed={preset===p} key={p} onClick={()=>setPreset(p)}><Box angle={p==='angle'}/><span><strong>{p==='front'?'정면 소개':'정면 + 옆면 소개'}</strong><small>{p==='front'?'앞면을 깔끔하게 보여줘요':'입체적인 모습과 옆면을 함께 보여줘요'}</small><em>{p==='front'?'정면 1장':'정면 · 옆면 · 사선 3장'}</em></span></button>)}</div>
        <div className={s.start}><p>첫 촬영은 <b>앞면과 옆면이 다른 불투명 상자</b>를 준비해주세요.<br/>사진은 이 브라우저에서만 처리되며 새로고침하면 사라져요.</p><button className={s.primary} onClick={()=>{started.current=new Date().toISOString();addLog('session_started');setPhase('capture');}}>촬영 시작하기 <span>→</span></button></div>
      </section> : phase==='capture' ? <>
        <div className={s.titleRow}><div><h1>{labels[active]}을 보여주세요</h1><p className={s.lead}>{hints[active]}</p></div><span className={s.counter}>{count}<small> / {views.length}장 확보</small></span></div>
        <div className={s.workspace}>
          <section className={s.captureArea} aria-label="촬영 화면">
            <div className={s.viewport} style={camera ? {aspectRatio:`${videoSize.w}/${videoSize.h}`} : undefined}>
              {candidate ? <img src={candidate.url} alt={`${labels[active]} 사진 후보`} className={s.preview}/> : camera ? <><video ref={video} autoPlay muted playsInline onLoadedMetadata={e=>setVideoSize({w:e.currentTarget.videoWidth,h:e.currentTarget.videoHeight})} className={s.preview}/><div className={s.guide} style={{width:`${72*Math.min(videoSize.w,videoSize.h)/videoSize.w}%`,height:`${72*Math.min(videoSize.w,videoSize.h)/videoSize.h}%`,left:'50%',top:'50%',transform:'translate(-50%,-50%)'}}><span>제품 전체를 중앙에 맞춰주세요</span></div><span className={s.live}>카메라 켜짐</span></> : <div className={s.empty}><Box angle={active!=='front'}/><h2>제품을 화면 가운데 놓아주세요</h2><p>배경은 단순하게, 조명은 충분히.<br/>앞면부터 천천히 시작해요.</p><button className={s.primary} disabled={starting||busy} onClick={startCamera}>{starting?'카메라 여는 중…':'카메라 열기'}</button></div>}
            </div>
            <div className={s.toolbar}>{camera ? <><button className={s.primary} disabled={!quality} onClick={shoot}>이 장면 촬영</button><button className={s.secondary} onClick={stop}>카메라 끄기</button></> : candidate ? <button className={s.secondary} onClick={()=>{setCandidate(null);setQuality(null);setConfirmed(false);}}>다시 촬영하기</button> : null}<button className={s.secondary} disabled={busy||starting} onClick={()=>input.current?.click()}>{busy?'사진 확인 중…':'사진 업로드'}</button><input aria-label="상품 사진 파일" ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></div>
            {error && <p role="alert" className={s.error}>{error}</p>}{notice && <p role="status" className={s.notice}>{notice}</p>}
          </section>
          <aside className={s.sidebar}>
            <h2>이번 연출에 필요한 사진</h2><ol className={s.checklist}>{views.map((v,i)=><li key={v} className={active===v?s.current:''}><button onClick={()=>retake(v)} aria-label={`${labels[v]} 촬영 선택`}><span className={s.index}>{i+1}</span><span><strong>{labels[v]}</strong><small>{photos[v]?'확보 · 눌러서 교체':v===active?'지금 촬영할 면':'아직 확보하지 않았어요'}</small></span>{photos[v] && <img src={photos[v]!.url} alt={`${labels[v]} 확보 사진`}/>}</button></li>)}</ol>
            <div className={s.inspection}><h2>사진 확인</h2><p className={s.note}>중앙 영역의 선명도와 밝기를 검사해요. 면과 제품의 잘림은 직접 확인해주세요.</p>{quality ? <><dl><div><dt>선명도</dt><dd>{quality.sharpness<45?'확인 필요':'경계 감지됨'}</dd></div><div><dt>밝기</dt><dd>{quality.brightness<38||quality.brightness>246?'확인 필요':'적정 범위'}</dd></div></dl>{(candidate?problems:quality.issues).map(x=><p className={s.error} key={x}>{x}</p>)}</> : <p className={s.waiting}>촬영하거나 사진을 올리면 검사가 시작돼요.</p>}
            {duplicate && <p className={s.error} role="alert">이미 확보한 {labels[duplicate]} 사진과 매우 비슷해요. 제품을 돌려 다른 면을 찍어주세요.</p>}
            {candidate && <><label className={s.confirm}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{active==='front'?'이 면이 제품의 앞면이며,':'안내한 면이 맞으며,'} 제품 전체가 가리지 않고 보이는 것을 확인했어요.</span></label><button className={s.primary} disabled={!confirmed||!!problems.length||!!duplicate} onClick={save}>{labels[active]} 사진 저장</button></>}
            </div>{count===views.length && <button className={s.secondary} onClick={()=>{stop();setPhase('review');}}>확보한 사진 확인하기</button>}
          </aside>
        </div></> : <section>
          <div className={s.titleRow}><div><h1>필요한 모습을 확보했어요.</h1><p className={s.lead}>선택한 사진을 확인하고, 광고 제작에 사용하세요.</p></div><span className={s.counter}>{count}<small> / {views.length}장</small></span></div>
          <div className={s.gallery}>{views.map(v=><article key={v}><img src={photos[v]!.url} alt={`확보한 ${labels[v]} 사진`}/><div><h2>{labels[v]}</h2><button className={s.secondary} onClick={()=>retake(v)}>교체 촬영</button></div><p>{photos[v]!.width} × {photos[v]!.height} · 면 직접 확인</p></article>)}</div>
          <div className={s.start}><p>사진과 촬영 기록을 하나의 ZIP으로 저장해요.<br/>확보된 자료가 생성 결과의 정확성을 보장하지는 않아요.</p><button className={s.primary} onClick={download}>사진 묶음 다운로드 <span>↓</span></button></div>{notice && <p className={s.notice} role="status">{notice}</p>}
        </section>}
      <footer className={s.footer}><span>필요한 면을 빠짐없이. 원본을 더 정확하게.</span><span>지원 대상: 불투명 제품 상자</span></footer>
    </div>
  </main>;
}
