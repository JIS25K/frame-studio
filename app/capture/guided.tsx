'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { analyzePixels, evaluateCaptureFrame, CAPTURE_QUALITY_LIMITS, type MotionState, type Quality } from '@/lib/capture/quality';
import { advanceConfirmation, sixViewSpec, verdictSchema, type Verdict } from '@/lib/capture/spec';
import { createZip } from '@/lib/capture/zip';
import s from './capture.module.css';
import c from './scan.module.css';
import g from './guided.module.css';

const MAX_SECONDS = 180;
type Evidence = { targetId: string; at: number; image: string; quality: Quality; verdict: Verdict; model: string; latencyMs: number; accepted: boolean; qualityHeldMs: number; invalidatedDuringRequest: boolean };
type Connection = { configured: boolean; accessRequired: boolean; model: string };
const viewNames = { front: '정면', side: '옆면', oblique: '사선', back: '후면', top: '윗부분', bottom: '바닥', right: '첫 번째 측면', left: '반대쪽 측면', detail: '부분 확대', unknown: '방향 불확실' };
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function sample(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas'); const ratio = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const crop = document.createElement('canvas'); crop.width = 160; crop.height = 160;
  const side = Math.min(canvas.width, canvas.height) * .72;
  crop.getContext('2d')!.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, 160, 160);
  const quality = analyzePixels(crop.getContext('2d')!.getImageData(0, 0, 160, 160).data, 160, 160);
  return { image: canvas.toDataURL('image/jpeg', .82), quality };
}
export default function GuidedCapture() {
  const spec = sixViewSpec;
  const [reanchor, setReanchor] = useState(false), [movementOverride, setMovementOverride] = useState('');
  const anchorRef = useRef(false);
  const [liveQuality, setLiveQuality] = useState<{ brightness: number; dark: number; light: number; sharpness: number; heldMs: number; changePerSecond: number | null; reason: string } | null>(null);
  const qualityLog = useRef<object[]>([]);
  const [phase, setPhase] = useState<'intro' | 'scan' | 'review'>('intro');
  const [connection, setConnection] = useState<Connection | null>(null), [code, setCode] = useState('');
  const [error, setError] = useState(''), [opening, setOpening] = useState(false), [status, setStatus] = useState('');
  const [running, setRunning] = useState(false), [busy, setBusy] = useState(false), [finishing, setFinishing] = useState(false);
  const [seconds, setSeconds] = useState(0), [calls, setCalls] = useState(0), [confirmations, setConfirmations] = useState(0);
  const [index, setIndex] = useState(0), [evidence, setEvidence] = useState<Evidence[]>([]), [accepted, setAccepted] = useState<Record<string, Evidence>>({});
  const [clipURL, setClipURL] = useState(''), [clip, setClip] = useState<Blob | null>(null), [recordingSupported, setRecordingSupported] = useState(true);
  const [size, setSize] = useState({ w: 9, h: 12 }), [reviewed, setReviewed] = useState(false), [exporting, setExporting] = useState(false);
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), recorder = useRef<MediaRecorder | null>(null);
  const session = useRef(0), alive = useRef(true), abort = useRef<AbortController | null>(null), urlRef = useRef('');
  const current = useRef(0), attempts = useRef(0), streak = useRef(0), acceptedRef = useRef<Record<string, Evidence>>({}), pending = useRef(false);
  const finishRef = useRef<(message?: string) => void>(() => {}), started = useRef(0);
  async function refreshConnection() {
    try { const response = await fetch('/api/capture/status', { cache: 'no-store' }); if (!response.ok) throw new Error(); const data = await response.json(); if (alive.current) { setConnection(data); setError(''); } }
    catch { if (alive.current) setError('AI 연결 상태를 불러오지 못했어요. 연결 확인을 다시 눌러주세요.'); }
  }
  useEffect(() => {
    alive.current = true;
    const initial = new AbortController();
    fetch('/api/capture/status', { cache: 'no-store', signal: initial.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (alive.current) setConnection(data); }).catch(() => { if (alive.current && !initial.signal.aborted) setError('AI 연결 상태를 불러오지 못했어요. 연결 확인을 다시 눌러주세요.'); });
    const token = session, live = alive, media = stream, rec = recorder, controller = abort, url = urlRef;
    return () => { initial.abort(); live.current = false; token.current++; controller.current?.abort(); if (rec.current?.state === 'recording') rec.current.stop(); media.current?.getTracks().forEach(t => t.stop()); if (url.current) URL.revokeObjectURL(url.current); };
  }, []);
  function finish(message?: string) {
    if (!stream.current) return;
    abort.current?.abort(); pending.current = false; setBusy(false);
    if (recorder.current?.state === 'recording') { setFinishing(true); recorder.current.stop(); }
    stream.current.getTracks().forEach(t => t.stop()); stream.current = null;
    setRunning(false); setPhase('review'); if (message) setError(message);
  }
  useEffect(() => { finishRef.current = finish; });
  async function begin() {
    const id = ++session.current; setOpening(true); setError('');
    try {
      const check = await fetch('/api/capture/status', { cache: 'no-store' }); const config: Connection = await check.json(); setConnection(config);
      if (!config.configured) throw new Error('AI API 키가 아직 연결되지 않았어요. 관리자에게 알려주세요.');
      if (config.accessRequired && !code.trim()) throw new Error('데모 접근 코드를 입력해주세요.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Safari 또는 Chrome에서 HTTPS 주소로 열어주세요.');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!alive.current || id !== session.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media; recorder.current = null; current.current = 0; attempts.current = 0; streak.current = 0; pending.current = false; acceptedRef.current = {};
      anchorRef.current = false; setReanchor(false); setMovementOverride('');
      qualityLog.current = []; setLiveQuality(null);
      setIndex(0); setCalls(0); setConfirmations(0); setEvidence([]); setAccepted({}); setReviewed(false); setSeconds(0); setClip(null); setClipURL(''); setFinishing(false);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = '';
      media.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (alive.current && session.current === id && stream.current === media) finishRef.current('카메라가 끊겼어요. 지금까지 모은 자료를 확인해주세요.'); }));
      setRecordingSupported(false);
      if (typeof MediaRecorder !== 'undefined') {
        try {
          const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
          const rec = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_800_000 }); const parts: Blob[] = []; let bytes = 0;
          rec.ondataavailable = e => { if (e.data.size && id === session.current) { parts.push(e.data); bytes += e.data.size; if (bytes > 45 * 1024 * 1024) finishRef.current('영상 용량 제한에 도달했어요. 모은 자료를 확인해주세요.'); } };
          rec.onstop = () => {
            if (!alive.current || session.current !== id) return;
            if (stream.current === media) finishRef.current('녹화가 중단됐어요. 부분 결과를 확인해주세요.');
            if (parts.length) { const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' }); setClip(blob); urlRef.current = URL.createObjectURL(blob); setClipURL(urlRef.current); }
            setFinishing(false);
          };
          rec.onerror = () => { if (alive.current && session.current === id) finishRef.current('녹화에 문제가 생겼어요. 저장된 사진을 확인해주세요.'); };
          recorder.current = rec; rec.start(1000); setRecordingSupported(true);
        } catch { setRecordingSupported(false); }
      }
      started.current = performance.now(); setStatus(spec.requirements[0].instruction); setPhase('scan'); setRunning(true);
    } catch (e) { if (alive.current && id === session.current) setError(e instanceof DOMException ? '카메라 권한을 허용하고 다시 시작해주세요.' : (e as Error).message); }
    finally { if (alive.current && id === session.current) setOpening(false); }
  }
  useEffect(() => {
    if (!running || !video.current) return;
    video.current.srcObject = stream.current;
    const id = session.current; let motion: MotionState | null = null, lastCall = -3000, lastQualityLog = -1000;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started.current; setSeconds(Math.floor(elapsed / 1000));
      if (elapsed >= MAX_SECONDS * 1000) { finishRef.current('촬영 시간이 끝났어요. 확보한 항목과 부족한 항목을 확인해주세요.'); return; }
      if (anchorRef.current) { motion = null; return; }
      if (!pending.current && attempts.current >= 36) { finishRef.current('이번 촬영의 AI 확인 36회를 사용했어요. 부족한 항목은 결과에서 확인해주세요.'); return; }
      const v = video.current; if (!v?.videoWidth || v.paused) return;
      const frame = sample(v), q = frame.quality;
      const gate = evaluateCaptureFrame(q, elapsed, motion); motion = gate.state;
      const metrics = { brightness: q.brightness, dark: q.dark, light: q.light, sharpness: q.sharpness, heldMs: gate.heldMs, changePerSecond: gate.changePerSecond, reason: gate.reason };
      setLiveQuality(metrics);
      if (elapsed - lastQualityLog >= 1000) { qualityLog.current.push({ at: elapsed, targetId: spec.requirements[current.current]?.id, ...metrics, ready: gate.ready }); lastQualityLog = elapsed; }
      if (!gate.ready) { streak.current = 0; setConfirmations(0); setStatus(gate.reason); return; }
      if (pending.current || elapsed - lastCall < 2500) return;
      const captureEpoch = gate.state.epoch;
      const target = spec.requirements[current.current]; if (!target) return;
      const reference = acceptedRef.current[spec.requirements[0].id]?.image || null;
      const context = Object.values(acceptedRef.current).filter(e => e.targetId !== 'front').slice(-4).map(e => ({ targetId: e.targetId, frame: e.image }));
      const controller = new AbortController(); abort.current = controller;
      pending.current = true; setBusy(true); setStatus('방금 장면에서 필요한 면과 부분을 확인하고 있어요.'); lastCall = elapsed; attempts.current++; setCalls(attempts.current);
      void (async () => {
        try {
          const response = await fetch('/api/capture/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-capture-code': code }, body: JSON.stringify({ spec, targetId: target.id, frame: frame.image, reference, context }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(26_000)]) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'AI 판정에 실패했어요.');
          if (!alive.current || id !== session.current || !stream.current || spec.requirements[current.current]?.id !== target.id) return;
          const verdict = verdictSchema.parse(data.verdict);
          const invalidatedDuringRequest = motion?.epoch !== captureEpoch;
          streak.current = invalidatedDuringRequest ? 0 : advanceConfirmation(streak.current, verdict, target, Boolean(reference)); setConfirmations(streak.current);
          const passed = streak.current >= 2;
          const entry: Evidence = { targetId: target.id, at: elapsed, image: frame.image, quality: q, verdict, model: data.model, latencyMs: data.latencyMs, accepted: passed, qualityHeldMs: gate.heldMs, invalidatedDuringRequest };
          setEvidence(prev => [...prev, entry]);
          if (passed) {
            setMovementOverride('');
            acceptedRef.current = { ...acceptedRef.current, [target.id]: entry }; setAccepted({ ...acceptedRef.current }); current.current++; setIndex(current.current); streak.current = 0; setConfirmations(0); motion = null;
            if (current.current >= spec.requirements.length) finishRef.current();
            else setStatus(spec.requirements[current.current].instruction);
          } else setStatus(invalidatedDuringRequest ? '확인하는 동안 움직임이나 조명이 바뀌었어요. 다시 멈춰주세요.' : streak.current ? '좋아요. 같은 위치에서 한 번 더 확인할게요.' : verdict.guidance);
        } catch (e) {
          if (alive.current && id === session.current && stream.current && !controller.signal.aborted) finishRef.current((e as Error).name === 'TimeoutError' ? 'AI 연결이 지연돼 촬영을 종료했어요. 모은 자료를 확인해주세요.' : (e as Error).message || 'AI 판정에 실패했어요.');
        } finally { if (alive.current && id === session.current) { pending.current = false; setBusy(false); } }
      })();
    }, 250);
    return () => clearInterval(timer);
  }, [running, spec, code]);
  async function exportResults() {
    setExporting(true);
    try {
      const files = evidence.map((e, i) => ({ name: `evidence/frame-${i + 1}.jpg`, data: Uint8Array.from(atob(e.image.split(',')[1]), ch => ch.charCodeAt(0)) }));
      for (const [key, e] of Object.entries(accepted)) files.push({ name: `selected/${key}.jpg`, data: Uint8Array.from(atob(e.image.split(',')[1]), ch => ch.charCodeAt(0)) });
      if (clip) files.push({ name: clip.type.includes('mp4') ? 'capture.mp4' : 'capture.webm', data: new Uint8Array(await clip.arrayBuffer()) });
      const manifest = { version: 4, spec, qualityPolicy: CAPTURE_QUALITY_LIMITS, qualityTimeline: qualityLog.current, reviewConfirmedByUser: reviewed, completeness: Object.keys(accepted).length === spec.requirements.length ? 'ai-targets-collected' : 'partial', missing: spec.requirements.filter(r => !accepted[r.id]).map(r => r.id), evidence: evidence.map((e, i) => ({ targetId: e.targetId, at: e.at, quality: e.quality, qualityHeldMs: e.qualityHeldMs, invalidatedDuringRequest: e.invalidatedDuringRequest, verdict: e.verdict, model: e.model, latencyMs: e.latencyMs, acceptedAtCapture: e.accepted, excludedByUser: e.accepted && !accepted[e.targetId], file: `evidence/frame-${i + 1}.jpg` })), limits: ['Coarse visual view/part classification, not measured camera pose or 3D coverage.', 'Two consecutive self-confidence >= .85 verdicts are a heuristic, not proof.', 'Product identity is relative to the first front capture, not verified against a catalog.', 'Image samples and front reference sent to OpenAI. Full video stays local.'] };
      files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      save(new Blob([new Uint8Array(createZip(files))], { type: 'application/zip' }), `capture-${spec.id}.zip`);
    } catch { setError('내보내기에 실패했어요. 영상만 먼저 저장해주세요.'); } finally { setExporting(false); }
  }
  function skipDirection() {
    if (busy || index === 0) return;
    current.current++; streak.current = 0; setConfirmations(0); setIndex(current.current);
    if (current.current >= spec.requirements.length) finish();
    else { anchorRef.current = true; setReanchor(true); setStatus('다음 촬영 전에 시작 자세로 돌아가주세요.'); }
  }
  function resumeFromStart() {
    const next = spec.requirements[current.current];
    const directions: Record<string, string> = { right: '시작 모습에서 시계 방향으로 ¼바퀴 돌린 뒤 멈추세요.', back: '시작 모습에서 시계 방향으로 반 바퀴 돌린 뒤 멈추세요. 처음 보이던 부분의 반대쪽을 보여주세요.', left: '시작 모습에서 시계 방향으로 ¾바퀴 돌린 뒤 멈추세요.', top: '시작 자세에서 제품 윗부분을 카메라 쪽으로 숙인 뒤 멈추세요.', bottom: '시작 자세에서 테이블에 닿던 바닥을 카메라 쪽으로 향하게 하고 멈추세요.' };
    const instruction = directions[next.id] || next.instruction;
    setMovementOverride(instruction); setStatus(instruction); anchorRef.current = false; setReanchor(false);
  }
  const target = spec.requirements[Math.min(index, spec.requirements.length - 1)];
  const count = Object.keys(accepted).length, progress = count / spec.requirements.length;
  return <main className={`${s.app} ${g.surface}`} lang="ko"><header className={s.header}><a href="/capture" className={s.brand}>FRAME<span>제품 촬영 스튜디오</span></a><span className={s.mode}>한 바퀴 + 위아래 촬영</span></header><div className={`${s.shell} ${c.shell}`}>
    <ol className={g.journey} aria-label="촬영 순서">{(['intro', 'scan', 'review'] as const).map((step, i) => <li key={step} aria-current={phase === step ? 'step' : undefined}><span aria-hidden="true">{i + 1}</span>{['촬영 준비', '연속 촬영', '결과 확인'][i]}</li>)}</ol>
    {error && <p className={s.error} role="alert">{error}</p>}
    {phase === 'intro' ? <section className={g.intro}>
      <div className={g.introHeading}><h1>한 바퀴 돌리고,<br />위아래까지 담아요.</h1><p className={s.lead}>휴대폰을 고정하고 제품만 움직여주세요.<br />시작 모습부터 여섯 방향을 차례로 안내할게요.</p></div>
      <div className={g.setupGrid}><div className={g.setupGuide}>
        <div className={g.sectionHeading}><h2>이렇게 촬영해요</h2><span>6방향</span></div>
        <ol className={g.requirements}>
          <li><span className={g.stepNumber}>1</span><div><strong>어느 쪽이든 시작해요</strong><span>평소 자세로 놓고 제품 전체를 보여주세요. 앞면을 정할 필요 없어요.</span></div></li>
          <li><span className={g.stepNumber}>2</span><div><strong>같은 방향으로 천천히 돌려요</strong><span>위에서 봤을 때 시계 방향. ¼바퀴씩 돌리고 잠깐 멈추면 다음 안내로 넘어가요.</span></div></li>
          <li><span className={g.stepNumber}>3</span><div><strong>윗부분, 바닥을 보여줘요</strong><span>제품을 기울여 각각 담아요. 들 수 없는 제품은 해당 방향을 건너뛸 수 있어요.</span></div></li>
        </ol>
      </div><div className={g.startPanel}>
        <div className={g.connection} role="status"><span className={g.statusDot} data-ready={connection?.configured || false} aria-hidden="true" /><span>{connection ? connection.configured ? 'AI 판정 준비됨' : 'AI 키 연결 대기' : '연결 확인 중…'}</span><button onClick={() => void refreshConnection()}>다시 확인</button></div>
        {!connection?.configured && <p className={s.note}>키가 연결되면 자동 판정을 시작할 수 있어요.</p>}
        {connection?.accessRequired && <label className={g.field}>데모 접근 코드<input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="전달받은 접근 코드를 붙여넣으세요" /></label>}
        <button className={s.primary} disabled={opening || !connection?.configured} onClick={() => void begin()}>{opening ? '카메라 여는 중…' : '촬영 시작'}<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></button>
        <p className={g.duration}>최대 3분 · 소리 없이 촬영</p><p className={g.privacy}>시작하면 선별 사진과 시작 사진과 이전 확보 사진을 OpenAI에 전송해요. 전체 영상은 기기에만 남아요.</p>
      </div></div>
      <details className={g.details}><summary>촬영 및 연결 안내</summary><p>연결 모델: {connection?.model || '확인 중'} · 최대 3분 · AI 확인 최대 36회. 무겁거나 액체가 새는 제품은 무리해서 뒤집지 마세요.</p><p>구나 원통처럼 방향을 구별할 수 없는 제품은 AI가 확인하지 못할 수 있어요. 그런 방향은 미확보로 남길 수 있어요.</p></details>
      <p className={s.note}>여섯 방향의 외부 모습을 수집해요. ¼바퀴는 움직임 안내이며 측정값이 아니에요. 3D 복원이나 모든 표면의 완전한 확보를 뜻하지 않아요.</p>
    </section> : phase === 'scan' ? <section className={`${c.scan} ${g.scan}`}>
      <div className={c.scanTitle}><h1>{reanchor ? '시작 자세를 다시 맞춰주세요' : target.label}</h1><span>{seconds}s / {MAX_SECONDS}s</span></div><div className={g.motionGuide}>
        {!reanchor && target.motion && <svg viewBox="0 0 80 80" aria-hidden="true" className={g.motionIcon}>
          {target.motion === 'clockwise' || target.motion === 'counterclockwise' ? <g transform={target.motion === 'counterclockwise' ? 'translate(80 0) scale(-1 1)' : undefined}><rect x="27" y="27" width="26" height="26" rx="2"/><path d="M18 48 A25 25 0 1 1 62 48 M62 35 V49 H48"/></g> : target.motion === 'tilt-top' || target.motion === 'tilt-bottom' ? <g transform={target.motion === 'tilt-bottom' ? 'translate(0 80) scale(1 -1)' : undefined}><rect x="25" y="22" width="30" height="36" rx="3"/><path d="M12 56 V25 M5 32 L12 25 L19 32 M31 29 H49"/></g> : target.motion === 'closer' ? <><rect x="28" y="20" width="24" height="40" rx="3"/><path d="M8 40 H23 M17 34 L23 40 L17 46 M72 40 H57 M63 34 L57 40 L63 46"/></> : <><rect x="25" y="16" width="30" height="48" rx="3"/><path d="M33 31 H47 M33 39 H47 M33 47 H43"/></>}
        </svg>}
        <div>{!reanchor && (target.motion === 'clockwise' || target.motion === 'counterclockwise') && <span className={g.motionCaption}>위에서 내려다본 방향 · 제품만 돌리세요</span>}<p className={g.target}>{reanchor ? '아래의 시작 사진을 보고 제품 자세를 맞춘 뒤 확인 버튼을 눌러주세요.' : movementOverride || target.instruction}</p></div>
      </div>
      <div className={`${c.camera} ${g.camera}`} style={{ aspectRatio: `${size.w}/${size.h}`, width: `min(100%, ${36 * size.w / size.h}svh)` }}><video ref={video} autoPlay muted playsInline onLoadedMetadata={e => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} /><div className={c.ring} style={{ width: `${82 * Math.min(size.w, size.h) / size.w}%`, height: `${82 * Math.min(size.w, size.h) / size.h}%` }}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100" /><circle cx="50" cy="50" r="47" pathLength="100" strokeDasharray={`${progress * 100} 100`} className={c.fill} /></svg></div><div className={c.guide} style={{ width: `${72 * Math.min(size.w, size.h) / size.w}%`, height: `${72 * Math.min(size.w, size.h) / size.h}%` }} /><span className={c.record}>{recordingSupported ? '영상 녹화 중' : '사진만 수집 중'}</span></div>
      {reanchor && <div className={g.reanchor} role="status"><img src={accepted.front.image} alt="다시 맞출 시작 모습"/><div><strong>이 사진과 같은 자세로 돌아가주세요</strong><p>건너뛴 뒤에는 회전 기준을 다시 맞춰요. 제품을 세우고 처음 보였던 부분을 카메라로 향하게 해주세요.</p><button className={s.secondary} onClick={resumeFromStart}>시작 모습으로 맞췄어요</button></div></div>}
      <div className={g.liveFeedback} aria-busy={busy}><p role="status">{status}</p><span>{busy ? 'AI 판정 중' : `현재 항목 확인 ${confirmations}/2`} · AI 확보 {count}/{spec.requirements.length}</span></div>
      {liveQuality && <details className={g.qualityDetails}><summary>촬영 품질 · 정지 {Math.min(2, liveQuality.heldMs / 1000).toFixed(1)}/2초 · {liveQuality.brightness < 38 || liveQuality.dark > .65 ? '어두움' : liveQuality.brightness > 246 || liveQuality.light > .45 ? '빛 과다' : '밝기 범위 안'}</summary><p>밝기 {liveQuality.brightness.toFixed(0)}/255 · 밝은 영역 손실 {(liveQuality.light * 100).toFixed(0)}% · 어두운 영역 손실 {(liveQuality.dark * 100).toFixed(0)}%<br/>경계 선명도 {liveQuality.sharpness.toFixed(0)} · 화면 변화/초 {liveQuality.changePerSecond?.toFixed(3) ?? '측정 중'}</p><p>중앙 가이드 영역 기준의 임시 임계값이에요. 실제 회전 속도나 제품 표면 전체의 품질을 측정한 값은 아니에요.</p></details>}
      <ul className={g.checklist} aria-label="항목별 촬영 상태">{spec.requirements.map((r, i) => <li key={r.id} data-complete={Boolean(accepted[r.id])} aria-current={i === index ? 'step' : undefined}><span>{r.label}</span><strong>{accepted[r.id] ? '확보' : i === index ? '확인 중' : '대기'}</strong></li>)}</ul>
      <button className={g.textButton} disabled={busy || reanchor || index === 0} onClick={skipDirection}>이 방향은 촬영하기 어려워요 · 건너뛰기</button><div className={g.captureActions}><button className={s.secondary} onClick={() => finish('촬영을 종료했어요. 부분 결과도 저장할 수 있어요.')}>촬영 마치고 확인</button><span>AI 확인 {calls}/36회</span></div>
    </section> : <section className={`${c.review} ${g.review}`}>
      <div className={g.reviewHeading}><h1>{count === spec.requirements.length ? '필요한 모습을 모았어요.' : '아직 부족한 모습이 있어요.'}</h1><p className={s.lead}>AI 확보 {count}/{spec.requirements.length} · 사진이 실물과 맞는지 확인해주세요.</p></div>
      <div className={g.reviewGrid}><div>
      <div className={g.sectionHeading}><h2>항목별 확인</h2><span>틀린 사진은 제외해주세요</span></div>
      <div className={g.results}>{spec.requirements.map(r => { const found = accepted[r.id]; return <article key={r.id} data-missing={!found}>{found ? <a className={g.photoLink} href={found.image} download={`${r.id}.jpg`} aria-label={`${r.label} 사진 다운로드`}><img src={found.image} alt={`${r.label} 확보 사진`} /></a> : <div className={g.missingPhoto}><span>미확보</span></div>}<div><h2>{r.label}<span>{found ? 'AI 확보' : '미확보'}</span></h2>{found ? <><details className={g.evidence}><summary>판정 근거 보기</summary><p>{found.verdict.evidence}</p></details><button className={g.textButton} onClick={() => { const next = { ...accepted }; delete next[r.id]; acceptedRef.current = next; setAccepted(next); setReviewed(false); }}>이 사진 제외</button></> : <p>{r.instruction}</p>}</div></article>; })}</div>
      </div><div className={g.reviewAside}>
      {finishing ? <p role="status">영상을 마무리하고 있어요…</p> : clipURL ? <div className={g.recording}><h2>촬영한 영상</h2><video src={clipURL} controls playsInline /><button className={g.textButton} onClick={() => clip && save(clip, clip.type.includes('mp4') ? 'capture.mp4' : 'capture.webm')}>영상만 저장</button></div> : <p className={s.note}>녹화된 영상이 없어요. 사진과 판정 기록은 저장할 수 있어요.</p>}
      {connection?.accessRequired && <details className={g.details} open={error.includes('코드')}><summary>접근 코드 수정</summary><label className={g.field}>데모 접근 코드 수정<input type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="수정 후 다시 촬영해주세요" /></label></details>}
      <div className={g.savePanel}><label className={g.check}><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />확보 사진과 미확보 항목을 확인했어요.</label>
      <button className={s.primary} disabled={!reviewed || finishing || exporting || (!evidence.length && !clip)} onClick={() => void exportResults()}>{exporting ? '파일 묶는 중…' : '촬영 자료 모두 저장'}</button><p className={s.note}>영상·사진·AI 판정 기록을 ZIP으로 저장해요.</p><button className={s.secondary} disabled={finishing || exporting} onClick={() => { if (window.confirm('새로 촬영할까요? 현재 자료는 먼저 저장해주세요.')) void begin(); }}>다시 촬영</button></div>
      </div></div>
      <details className={g.details}><summary>전체 AI 판정 기록 · {evidence.length}건</summary>{evidence.map((e, i) => <div className={g.log} key={i}><img src={e.image} alt={`판정 ${i + 1}에 사용한 사진`} /><p><strong>{(e.at / 1000).toFixed(1)}초 · {viewNames[e.verdict.observedView]} · {e.accepted ? '항목 확보' : '추가 확인'}</strong><br />{e.verdict.evidence}<br />{e.verdict.guidance}</p></div>)}</details><p className={s.note}>AI 판정은 오판할 수 있으며 3D 복원·모든 각도 확보·광고 정확성을 보장하지 않아요.</p>
    </section>}
    <footer className={s.footer}><span>제품의 모습을 빠짐없이 살펴봐요.</span><span>새로고침하면 자료가 사라져요.</span></footer>
  </div></main>;
}
