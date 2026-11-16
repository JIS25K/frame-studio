'use client';
/* User-supplied data URLs are already resized locally and must not go through an image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { MAX_IMAGES, MAX_REQUEST_LENGTH, MAX_SHOTS, inputError, briefSchema, fieldLabels, shotFields, type Brief, type Proposal, type Plan } from '@/lib/prompt-engine/schema';
import { compilePrompts, makePackage } from '@/lib/prompt-engine/engine';
import { emptyWorkspace, type Workspace } from '@/lib/prompt-engine/workspace';
import { download, loadWorkspace, prepareImage, saveWorkspace, loadHandoff, prepareModelBrief } from '@/lib/prompt-engine/browser';
import { importHandoff, needsImportChoice, type CaptureHandoff } from '@/lib/prompt-engine/handoff';
import StudioNav from '../studio-nav';
import styles from './studio.module.css';

type Connection = { configured: boolean; };
function Arrow() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" /></svg>; }
function Plus() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>; }
async function readConnection(): Promise<Connection> {
  const response = await fetch('/api/prompt/status', { cache: 'no-store' });
  if (!response.ok) throw new Error('AI 연결 상태를 확인하지 못했어요. 연결 확인을 다시 눌러주세요.');
  return response.json();
}

export default function PromptStudio() {
  const [work, setWork] = useState<Workspace>(emptyWorkspace);
  const [pendingImport, setPendingImport] = useState<CaptureHandoff | null>(null);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState('');
  const [requestPending, setRequestPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storage, setStorage] = useState('');
  const [storageError, setStorageError] = useState('');
  const [revision, setRevision] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const { brief, proposal, plan, phase, approvedAt } = work;

  async function refreshConnection() {
    try {
      setConnection(await readConnection());
    } catch { setConnection(null); setError('AI 연결 상태를 확인하지 못했어요. 연결 확인을 다시 눌러주세요.'); }
  }
  useEffect(() => {
    let active = true;

    void (async () => {
      let saved: Workspace | null = null;
      try { saved = await loadWorkspace(); if (active && saved) { setWork(saved); setNotice(''); } }
      catch { if (active) setStorageError('저장된 작업을 읽지 못했어요. 중요한 작업은 파일로 저장해주세요.'); }
      const id = new URLSearchParams(window.location.search).get('capture');
      if (id) try {
        const packet = await loadHandoff(id);
        if (!active) return;
        if (saved?.captureSource?.id === id) { window.history.replaceState(null, '', '/prompt'); }
        else if (saved && needsImportChoice(saved, packet)) setPendingImport(packet);
        else { const next = importHandoff(packet); await saveWorkspace(next); if (active) { setWork(next); setNotice(''); window.history.replaceState(null, '', '/prompt'); } }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '촬영 사진을 불러오지 못했어요.'); }
      if (active) setReady(true);
    })();
    void readConnection().then(c => { if (active) setConnection(c); }).catch(() => { if (active) setError('AI 연결 상태를 확인하지 못했어요. 연결 확인을 다시 눌러주세요.'); });
    return () => { active = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void saveWorkspace(work).then(() => { setStorage('이 기기에 저장됨'); setStorageError(''); }).catch(() => { setStorage(''); setStorageError('자동 저장에 실패했어요. 확정 후 파일로 저장해주세요.'); }); }, 350);
    return () => clearTimeout(timer);
  }, [work, ready]);
  useEffect(() => { if (ready) title.current?.focus(); }, [phase, ready]);

  function changeBrief(patch: Partial<Brief>) {
    setWork(w => ({ ...emptyWorkspace, captureSource: w.captureSource, brief: { ...w.brief, ...patch } }));
    setError(''); setNotice(''); setRevision(''); setAnswers({});
  }
  async function addImages(e: ChangeEvent<HTMLInputElement>, role: 'product' | 'reference') {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length || lock.current) return;
    if (brief.images.length + files.length > MAX_IMAGES) { setError('제품과 레퍼런스를 합쳐 최대 24장까지 넣을 수 있어요.'); return; }
    lock.current = true; setBusy('사진을 준비하고 있어요'); setError('');
    try {
      const images = await Promise.all(files.map(async file => ({ id: crypto.randomUUID(), name: file.name.slice(0, 150), role, data: await prepareImage(file) })));
      changeBrief({ images: [...brief.images, ...images] });
    } catch (e) { setError(e instanceof Error ? e.message : '사진을 읽지 못했어요.'); }
    finally { lock.current = false; setBusy(''); }
  }
  async function example() {
    if (lock.current) return; lock.current = true; setBusy('예시 제품을 불러오고 있어요'); setError('');
    try {
      const response = await fetch('/prompt/lumi-reference.png'); if (!response.ok) throw new Error();
      const image = await prepareImage(new File([await response.blob()], 'LUMI 가상 화장품.png', { type: 'image/png' }));
      changeBrief({ images: [{ id: 'lumi-product', name: 'LUMI 가상 화장품', role: 'product', data: image }], request: '촉촉하고 고급스러운 느낌의 세럼 광고 사진을 만들고 싶어요. 제품이 잘 보였으면 좋겠어요.', count: 1, ratio: '1:1' });
    } catch { setError('예시 사진을 불러오지 못했어요. 다시 눌러주세요.'); }
    finally { lock.current = false; setBusy(''); }
  }
  async function requestAI(payload: object) {
    controller.current = new AbortController();
    setRequestPending(true);
    try {
      const response = await fetch('/api/prompt/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(175_000)]) });
      const result = await response.json().catch(() => ({ error: '서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요. 입력은 유지됩니다.' }));
      if (!response.ok) throw new Error(result.error || '요청을 완료하지 못했어요.');
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('응답 시간이 길어져 중단했어요. 입력은 유지됩니다. 다시 제안받기를 눌러주세요.');
      if (error instanceof TypeError) throw new Error('서버에 연결하지 못했어요. 입력은 유지됩니다. 연결을 확인한 뒤 다시 시도해주세요.');
      throw error;
    } finally { setRequestPending(false); controller.current = null; }
  }
  async function propose(e?: FormEvent) {
    e?.preventDefault(); if (lock.current) return;
    const checked = briefSchema.safeParse(brief);
    if (!checked.success) { setError(inputError(checked.error)); return; }
    if (!connection?.configured) { setError('AI 연결이 필요해요. 아래 연결 안내를 확인해주세요.'); return; }
    const nextAnswers = [...work.answers, ...(proposal?.questions || []).map(q => ({ question: `${q.question} ${q.reason}`.slice(0, 500), answer: (answers[q.id] || '').trim() }))];
    if (nextAnswers.some(a => !a.answer)) { setError('확인이 필요한 항목을 선택하거나 짧게 답해주세요.'); return; }
    if (nextAnswers.length > 6) { setError('선택 내용을 원래 요청에 넣어 다시 시작해주세요.'); return; }
    lock.current = true; setBusy('사진을 읽고 연출을 구체화하고 있어요'); setError(''); setNotice('');
    try {
      const result = await requestAI({ action: 'propose', brief: await prepareModelBrief(checked.data), answers: nextAnswers }) as { proposal: Proposal };
      setWork(w => ({ ...w, proposal: result.proposal, phase: 'directions', plan: null, answers: nextAnswers, approvedAt: null })); setAnswers({});
    } catch (e) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '요청을 취소했어요. 입력과 기존 계획은 유지됩니다.'); }
    finally { setBusy(''); lock.current = false; }
  }
  async function revise(e: FormEvent) {
    e.preventDefault(); if (lock.current || !plan || !proposal || revision.trim().length < 2) return;
    lock.current = true; setBusy('요청한 부분만 계획에 반영하고 있어요'); setError(''); setNotice('');
    try {
      const result = await requestAI({ action: 'revise', brief: await prepareModelBrief(brief), proposal, plan, request: revision.trim() }) as { plan?: Plan; clarification?: string; message: string };
      if (result.clarification) { setError(result.clarification); return; }
      if (!result.plan) throw new Error('수정 계획을 읽지 못했어요.');
      setWork(w => ({ ...w, plan: result.plan!, approvedAt: null })); setRevision(''); setNotice(result.message);
    } catch (e) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '요청을 취소했어요. 기존 계획은 유지됩니다.'); }
    finally { setBusy(''); lock.current = false; }
  }
  function choose(direction: Proposal['directions'][number]) {
    setWork(w => ({ ...w, phase: 'plan', plan: { direction, revision: 1, history: [] }, approvedAt: null }));
    setRevision(''); setNotice(''); setError('');
  }
  function restart() {
    if (!window.confirm('현재 작업을 비우고 새로 시작할까요? 필요한 계획은 먼저 파일로 저장해주세요.')) return;
    setWork(emptyWorkspace); setRevision(''); setAnswers({}); setError(''); setNotice('');
  }
  function exportPackage() {
    if (!proposal || !plan) return;
    try { download('frame-production-plan.json', JSON.stringify({ ...makePackage(brief, proposal, plan, approvedAt), captureSource: work.captureSource }, null, 2), 'application/json'); setNotice('원본 사진과 제작 계획을 함께 저장했어요.'); }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); }
  }
  const prompts = proposal && plan ? compilePrompts(brief, proposal, plan) : [];
  const promptText = prompts.map(p => p.prompt).join('\n\n──────────\n\n');
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(promptText); setNotice('제작용 프롬프트를 복사했어요. 제작 시 원본 사진도 함께 첨부해주세요.'); }
    catch { setError('복사 권한이 없어요. 프롬프트 파일 저장을 이용해주세요.'); }
  }
  const step = phase === 'brief' ? 0 : phase === 'directions' ? 1 : 2;
  return <div className={styles.app} lang="ko">
    <div className={styles.shell}>
      <StudioNav active="prompt" action={<button type="button" onClick={restart} disabled={!!busy || !ready}>새 작업</button>} />
      <nav aria-label="기획 단계" className={styles.steps}><ol>{['제품과 요청', '연출 고르기', '제작 계획'].map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined} data-active={i === step} data-done={i < step}><span>{i + 1}</span>{label}</li>)}</ol><span className={styles.saved}>{storage}</span></nav>
      {!ready ? <p role="status" className={styles.loading}>작업 공간을 열고 있어요.</p> : <div className={styles.workspace} data-phase={phase}>
        <main className={styles.main}>
          <div className={styles.heading}><h1 ref={title} tabIndex={-1}>{phase === 'brief' ? '어떤 장면을 만들까요?' : phase === 'directions' ? '연출을 선택하세요' : approvedAt ? '제작 계획 완성' : '제작 계획 확인'}</h1>
            <p>{phase === 'brief' ? (brief.images.some(image => image.role === 'product') ? '원하는 느낌을 입력하세요.' : '사진과 원하는 느낌을 입력하세요.') : phase === 'directions' ? '마음에 드는 방향을 고른 뒤 수정할 수 있어요.' : approvedAt ? '사진과 프롬프트를 저장하세요.' : '수정할 부분이 있다면 아래에 입력하세요.'}</p></div>

          {pendingImport && <section className={styles.importChoice} aria-label="촬영 사진 가져오기"><h2>진행 중인 기획이 있어요</h2><p>새 촬영 사진 {pendingImport.images.length}장으로 시작할까요? 현재 기획은 선택하기 전까지 유지됩니다.</p><div className={styles.images}>{pendingImport.images.slice(0, 3).map(i => <figure key={i.id}><img src={i.data} alt={i.name} /></figure>)}</div><div className={styles.exportActions}><button className={styles.primary} type="button" onClick={async () => { try { const next = importHandoff(pendingImport); await saveWorkspace(next); setWork(next); setPendingImport(null); setNotice(''); window.history.replaceState(null, '', '/prompt'); } catch { setError('저장 공간이 부족해 사진을 가져오지 못했어요. 기존 기획은 유지됩니다.'); } }}>새 촬영 사진으로 시작</button><button className={styles.secondary} type="button" onClick={() => { setPendingImport(null); window.history.replaceState(null, '', '/prompt'); }}>기존 기획 계속</button></div></section>}
          {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
          {error && <div role="alert" className={styles.error}>{error}<button type="button" aria-label="오류 안내 닫기" onClick={() => setError('')}>닫기</button></div>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          {busy && <div role="status" className={styles.busy}><span className={styles.spinner} aria-hidden="true" />{busy}{requestPending && <button type="button" onClick={() => controller.current?.abort()}>취소</button>}</div>}

          {work.captureSource && <div className={styles.captureReceipt}><strong>{brief.videoContext ? '영상 관찰 정보 연결됨' : work.captureSource.demo ? '체험 사진 연결됨' : '촬영 사진 연결됨'} · {brief.images.filter(i => work.captureSource?.imageIds.includes(i.id)).length}장</strong>{work.captureSource.unresolved.length > 0 && <details><summary>촬영에서 확인이 남은 부분 {work.captureSource.unresolved.length}건</summary><ul>{work.captureSource.unresolved.map((item, i) => <li key={i}>{item}</li>)}</ul><p>필요한 부분이 보이는지 확인해주세요.</p></details>}</div>}
          {phase === 'brief' && <form onSubmit={propose}>
            <fieldset disabled={!!busy} className={styles.fieldset}>
              <div className={styles.labelRow}><h2>제품 사진</h2><span>최대 24장</span></div>
              <div className={styles.images}>{brief.images.filter(i => i.role === 'product').map(i => <figure key={i.id}><img src={i.data} alt={`제품 원본: ${i.name}`} /><figcaption>{i.name}</figcaption><button type="button" aria-label={`${i.name} 삭제`} onClick={() => changeBrief({ images: brief.images.filter(x => x.id !== i.id) })}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></figure>)}
                <label className={styles.upload}><Plus /><span>사진 추가</span><input aria-label="제품 사진 추가" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => void addImages(e, 'product')} /></label></div>
              {!brief.images.length && <button className={styles.example} type="button" onClick={example}>예시 제품 불러오기 <Arrow /></button>}
              <label className={styles.requestLabel} htmlFor="brief-request">원하는 느낌</label>
              <textarea id="brief-request" className={styles.request} rows={4} maxLength={MAX_REQUEST_LENGTH} value={brief.request} onChange={e => changeBrief({ request: e.target.value })} placeholder="예: 촉촉하고 고급스러운 세럼 광고 사진. 제품이 잘 보였으면 좋겠어요." required minLength={3} />
              <details className={styles.reference}><summary>연출 레퍼런스 <span>선택</span></summary><p>배경·구도·조명을 참고할 사진을 추가하세요.</p><div className={styles.images}>{brief.images.filter(i => i.role === 'reference').map(i => <figure key={i.id}><img src={i.data} alt={`연출 레퍼런스: ${i.name}`} /><figcaption>{i.name}</figcaption><button type="button" aria-label={`${i.name} 삭제`} onClick={() => changeBrief({ images: brief.images.filter(x => x.id !== i.id) })}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></figure>)}<label className={styles.upload}><Plus /><span>레퍼런스 추가</span><input aria-label="레퍼런스 사진 추가" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => void addImages(e, 'reference')} /></label></div></details>
              <div className={styles.settings}><label>만들 장수<select value={brief.count} onChange={e => changeBrief({ count: Number(e.target.value) })}>{Array.from({ length: MAX_SHOTS }, (_, i) => i + 1).map(n => <option value={n} key={n}>{n}장</option>)}</select></label><label>화면 비율<select value={brief.ratio} onChange={e => changeBrief({ ratio: e.target.value as Brief['ratio'] })}><option value="1:1">1:1 · 정사각형</option><option value="4:5">4:5 · 세로형</option><option value="9:16">9:16 · 긴 세로형</option></select></label></div>
            </fieldset>
            {(!connection?.configured) && <div className={styles.connection}>
              {!connection?.configured && <p>AI 연결 {connection === null ? '확인 중' : '준비 중'}. 연결 확인을 다시 눌러주세요.</p>}
              {!connection?.configured && <button type="button" className={styles.textButton} onClick={refreshConnection}>연결 다시 확인</button>}
            </div>}
            <button className={styles.primary} disabled={!!busy || !connection?.configured || !brief.images.some(i => i.role === 'product') || brief.request.trim().length < 3} type="submit">연출 제안받기 <Arrow /></button>
            <p className={styles.finePrint}>사진과 요청은 OpenAI로 전송됩니다.</p>
          </form>}

          {phase === 'directions' && proposal && <>
            {!!proposal.questions.length && <form onSubmit={propose} className={styles.questions}><h2>이것만 확인해주세요</h2>{proposal.questions.map(q => <fieldset key={q.id} disabled={!!busy}><legend>{q.question}</legend><p>{q.reason}</p><div className={styles.options}>{q.options.map(o => <button type="button" key={o} aria-pressed={answers[q.id] === o} onClick={() => setAnswers(a => ({ ...a, [q.id]: o }))}>{o}</button>)}</div><input aria-label={`${q.question} 직접 답변`} maxLength={500} placeholder="직접 답해도 좋아요" value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} /></fieldset>)}<button className={styles.primary} disabled={!!busy} type="submit">답변 반영하기 <Arrow /></button></form>}
            <div className={styles.directions}>{proposal.directions.map((d, i) => <article key={d.id} className={styles.direction}>
              <div className={styles.directionTop}><span className={styles.optionLetter}>{String.fromCharCode(65 + i)}</span><div className={styles.palette} aria-label="제안하는 배경 색상">{d.palette.map((c, j) => <span key={j} style={{ background: c }} />)}</div></div>
              <h2>{d.title}</h2><p className={styles.directionSummary}>{d.summary}</p><p className={styles.reason}>{d.reason}</p>
              <ul className={styles.shotList}>{d.shots.map((s, j) => <li key={s.id}><span>{j + 1}</span><div><strong>{s.title}</strong><p>{s.composition}</p></div></li>)}</ul>
              <button type="button" className={styles.secondary} disabled={!!busy || !!proposal.questions.length} onClick={() => choose(d)}>이 방향으로 구체화 <Arrow /></button>
            </article>)}</div>
            <p className={styles.finePrint}>이미지 생성 전, 연출을 정하는 단계입니다.</p>
            <button type="button" className={styles.textButton} disabled={!!busy} onClick={() => { setWork(w => ({ ...w, phase: 'brief', approvedAt: null })); setError(''); }}>제품·요청 수정하기</button>
          </>}

          {phase === 'plan' && plan && proposal && <>
            <div className={styles.planTop}><h2>{plan.direction.title}</h2><span>{approvedAt ? '확정됨' : `초안 v${plan.revision}`} · {brief.count}장 · {brief.ratio}</span></div>
            <div className={styles.shots}>{plan.direction.shots.map((s, i) => <article key={s.id} className={styles.shot}><div className={styles.shotHeader}><span>컷 {i + 1}</span><h3>{s.title}</h3></div><dl>{shotFields.map(f => <div key={f}><dt>{fieldLabels[f]}</dt><dd>{s[f]}</dd></div>)}</dl></article>)}</div>
            {!approvedAt && <form className={styles.revision} onSubmit={revise}><label htmlFor="revision">수정 요청</label><div><textarea id="revision" rows={2} maxLength={1000} value={revision} disabled={!!busy} onChange={e => setRevision(e.target.value)} placeholder="예: 배경만 연한 파란색으로 바꿔줘. 물방울은 빼줘." /><button type="submit" className={styles.secondary} disabled={!!busy || revision.trim().length < 2}>계획에 반영</button></div>{revision && <button type="button" className={styles.textButton} disabled={!!busy} onClick={() => { setRevision(''); setError(''); }}>입력 취소</button>}</form>}
            {!!plan.history.length && <details className={styles.history}><summary>변경 기록 · {plan.history.length}회</summary>{plan.history.toReversed().map(h => <section key={h.revision}><h3>v{h.revision} · {h.request}</h3>{h.changes.map(c => <p key={`${c.shotId}-${c.field}`}><strong>컷 {plan.direction.shots.findIndex(s => s.id === c.shotId) + 1} · {fieldLabels[c.field]}</strong><del>{c.before}</del><span>{c.after}</span></p>)}</section>)}</details>}
            {approvedAt ? <div className={styles.exports}><div className={styles.exportHeading}><h2>확정된 제작 패키지</h2></div><button type="button" className={styles.primary} onClick={exportPackage}>원본 포함 제작 패키지 저장 <Arrow /></button><div className={styles.exportActions}><button type="button" className={styles.secondary} onClick={copyPrompt}>프롬프트 복사</button><button type="button" className={styles.secondary} onClick={() => download('frame-prompts.txt', promptText, 'text/plain;charset=utf-8')}>프롬프트 파일 저장</button></div><p className={styles.finePrint}>제작할 때 제품 사진도 함께 첨부하세요.</p><button className={styles.textButton} type="button" onClick={() => { setWork(w => ({ ...w, approvedAt: null })); setNotice('확정을 해제했어요. 수정 후 다시 확정해주세요.'); }}>계획 다시 수정하기</button></div> : <div className={styles.confirm}><button className={styles.primary} type="button" disabled={!!busy || !!revision.trim()} onClick={() => { setWork(w => ({ ...w, approvedAt: new Date().toISOString() })); setNotice('이 계획을 확인하고 확정했어요.'); title.current?.focus(); }}>이 계획으로 확정하기 <Arrow /></button>{revision.trim() && <p className={styles.finePrint}>작성 중인 수정 요청을 반영하거나 취소한 뒤 확정해주세요.</p>}<button className={styles.textButton} type="button" disabled={!!busy} onClick={() => { setWork(w => ({ ...w, phase: 'directions', approvedAt: null })); setError(''); setNotice('다른 방향을 선택하면 해당 방향의 새 초안으로 시작합니다.'); }}>다른 연출 살펴보기</button></div>}
            <details className={styles.promptDetails}><summary>제작용 프롬프트 보기</summary><pre>{promptText}</pre></details>
          </>}
        </main>
        {phase !== 'brief' && <aside className={styles.aside} aria-label="제품과 기획 기준">
          <div className={styles.asideInner}>{brief.images.some(i => i.role === 'product') && <><div className={styles.productPhoto}><img src={brief.images.find(i => i.role === 'product')!.data} alt="기준이 되는 제품 원본" /><span>제품 원본</span></div><h2>{proposal?.productName || '제품 사진'}</h2></>}
            {proposal && <>{!!proposal.requirements?.length && <div className={styles.identity}><h3>꼭 반영할 요청</h3><ul>{proposal.requirements.map(r => <li key={r.id}>{r.text}</li>)}</ul></div>}<div className={styles.identity}><h3>유지할 제품 특징</h3><ul>{proposal.identity.map((f, i) => <li key={i}>{f.text}</li>)}</ul></div>{!!proposal.references.length && <div className={styles.identity}><h3>레퍼런스에서 가져올 것</h3>{proposal.references.map(r => <p key={r.imageId}>{r.use}<small>제외: {r.exclude}</small></p>)}</div>}{!!proposal.unknowns.length && <details className={styles.unknowns}><summary>사진만으로 알 수 없는 정보</summary><ul>{proposal.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></details>}</>}
            <div className={styles.original}><h3>처음 요청</h3><p>{brief.request}</p>{work.answers.map((a, i) => <p key={i}>추가 확인: {a.answer}</p>)}<span>{brief.count}장 · {brief.ratio}</span></div>
          </div>
        </aside>}
      </div>}

    </div>
  </div>;
}
