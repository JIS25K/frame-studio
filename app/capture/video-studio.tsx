"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StudioNav from "../studio-nav";
import { MarkedPhoto } from "./marked-photo";
import { VideoRecorder } from "./video-recorder";
import {
  analyzeSession,
  addClip,
  newSession,
  type Progress,
} from "@/lib/video-capture/engine";
import { audit } from "@/lib/video-capture/ledger";
import { saveVideoSession, loadVideoSession } from "@/lib/video-capture/store";
import {
  VIDEO_LIMITS,
  type VideoSession,
  type Gap,
} from "@/lib/video-capture/schema";
import { saveHandoff } from "@/lib/prompt-engine/browser";
import { createHandoff } from "@/lib/prompt-engine/handoff";
import s from "./video-studio.module.css";
const stateLabel: Record<string, string> = {
  closed: "닫힘",
  open: "열림",
  fixed: "고정",
  unknown: "상태 미확인",
};
const qualityLabel: Record<string, string> = {
  clear: "선명",
  blurred: "흐림",
  occluded: "가림",
  too_small: "작게 보임",
  uncertain: "확인 필요",
};
function gapEvidence(g: Gap) {
  return g.status === "evidence_added"
    ? g.support.at(-1) || g.anchor
    : g.anchor;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WholeVideoStudio({
  planning = true,
}: {
  planning?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState<VideoSession | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [record, setRecord] = useState(false),
    [target, setTarget] = useState<Gap | null>(null),
    [clipIndex, setClipIndex] = useState(0),
    [url, setUrl] = useState("");
  const abort = useRef<AbortController | null>(null),
    file = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    mounted = useRef(true),
    pendingSeek = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    void loadVideoSession()
      .then((s) => {
        if (mounted.current) {
          setSession(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        setLoaded(true);
        setError("이 기기의 이전 기록을 불러오지 못했어요.");
      });
    const control = abort;
    return () => {
      mounted.current = false;
      control.current?.abort();
    };
  }, []);
  const selected = session?.clips[clipIndex];
  useEffect(() => {
    if (!selected) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(selected.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [selected]);
  const summary = session ? audit(session) : null;
  // Publish the analysis source, not a previous React snapshot whose arrays may be stale.
  function render() {
    if (mounted.current)
      setSession(
        session
          ? {
              ...session,
              clips: [...session.clips],
              regions: [...session.regions],
              gaps: [...session.gaps],
            }
          : null,
      );
  }
  async function receive(
    blob: Blob,
    name: string,
    baseline: string | null = null,
  ) {
    if (blob.size > VIDEO_LIMITS.maxBytes) {
      setError(
        "200MB 이하의 영상을 사용해주세요. 일부 구간만 잘라 분석하지 않았습니다.",
      );
      return;
    }
    const next = session || newSession();
    addClip(next, blob, name, target?.id || null);
    if (!next.baseline && baseline) next.baseline = baseline;
    setClipIndex(next.clips.length - 1);
    setSession({ ...next });
    setRecord(false);
    setError("");
    try {
      await saveVideoSession(next);
    } catch (e) {
      setError((e as Error).message);
    }
    setTarget(null);
  }
  async function run() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await analyzeSession(
        session,
        (p) => {
          if (mounted.current) setProgress(p);
        },
        render,
        controller.signal,
      );
    } catch (e) {
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "분석을 멈췄어요. 완료된 구간부터 이어서 진행할 수 있어요."
            : (e as Error).message,
        );
    } finally {
      if (mounted.current) {
        setBusy(false);
        render();
      }
    }
  }
  function seek(id: string, time: number) {
    const i = session?.clips.findIndex((c) => c.id === id) ?? -1;
    if (i < 0) return;
    if (i === clipIndex && video.current) {
      video.current.currentTime = time;
      void video.current.play().catch(() => {});
    } else {
      pendingSeek.current = time;
      setClipIndex(i);
    }
    video.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function handoff() {
    if (!session || !summary?.complete) return;
    try {
      const candidates = session.regions.flatMap((r) =>
        r.evidence
          .filter((e) => e.verified && e.quality === "clear")
          .slice(0, 1)
          .map((e) => ({
            image: e.image,
            at: e.time,
            description: r.label + " · " + e.detail,
          })),
      );
      const unique = candidates
        .filter(
          (e, i) => candidates.findIndex((x) => x.image === e.image) === i,
        )
        .slice(0, 24);
      const packet = createHandoff({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        reviewed: true,
        demo: false,
        videoContext: {
          sessionId: session.id,
          decodedFrames: summary.decoded,
          processedWindows: summary.done,
          clips: session.clips.map((c) => ({
            id: c.id,
            name: c.name,
            duration: c.decoded!.duration,
            frames: c.decoded!.frameCount,
          })),
          regions: session.regions.map((r) => ({
            key: r.key,
            label: r.label,
            state: r.state,
            evidence: r.evidence.map(
              ({ clipId, time, frame, quality, verified, detail }) => ({
                clipId,
                time,
                frame,
                quality,
                verified,
                detail,
              }),
            ),
          })),
          gaps: session.gaps.map(
            ({ key, label, state, reason, instruction, status }) => ({
              key,
              label,
              state,
              reason,
              instruction,
              status,
            }),
          ),
        },
        frames: unique,
        unresolved: session.gaps
          .filter((g) => g.status !== "evidence_added")
          .map((g) => `${g.label}: ${g.reason}`.slice(0, 500))
          .slice(0, 24),
      });
      await saveHandoff(packet);
      router.push(`/prompt?capture=${packet.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function exportReport() {
    if (!session) return;
    const report = {
      ...session,
      baseline: undefined,
      clips: session.clips.map((c) => ({
        ...c,
        blob: undefined,
        decoded: c.decoded
          ? {
              ...c.decoded,
              sheets: c.decoded.sheets.map(({ image, ...sheet }) => sheet),
            }
          : null,
      })),
      audit: summary,
      limitations: [
        "All frames are decoded and submitted in chronological filmstrips; native region crops are separately verified.",
        "2D patch tracks are not object segmentation, camera pose or a 3D coverage certificate.",
        "Visual region correspondence and unseen-region hypotheses remain model estimates.",
      ],
    };
    download(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      "frame-whole-video-evidence.json",
    );
  }
  if (record)
    return (
      <VideoRecorder
        target={target ? `${target.label}: ${target.instruction}` : ""}
        onDone={(blob, baseline) =>
          void receive(
            blob,
            `촬영 ${new Date().toLocaleTimeString("ko-KR")}`,
            baseline,
          )
        }
        onCancel={() => setRecord(false)}
      />
    );
  return (
    <main className={s.app}>
      {planning ? (
        <StudioNav active="capture" />
      ) : (
        <header className={s.heading}>
          <strong>FRAME</strong>
        </header>
      )}
      <header className={s.heading}>
        <h1>영상으로 제품 관찰</h1>
        <p>처음부터 끝까지 살펴보고, 부족한 부분을 이어서 촬영하세요.</p>
      </header>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {!loaded ? (
        <p>이 기기의 관찰 기록을 불러오는 중…</p>
      ) : (
        <>
          <section className={s.intake} aria-label="영상 추가">
            <div>
              <strong>
                {target ? `${target.label} 보충 영상` : "제품 전체가 담긴 영상"}
              </strong>
              <p>
                {target
                  ? target.instruction
                  : "기준 정면에서 한 방향으로 돌리고, 위·아래와 작은 연결부도 보여주세요. 한 영상 최대 3분·200MB."}
              </p>
            </div>
            <div className={s.actions}>
              <button disabled={busy} onClick={() => setRecord(true)}>
                영상 촬영{target ? " · 보충" : ""}
              </button>
              <button
                disabled={busy}
                className={s.secondary}
                onClick={() => file.current?.click()}
              >
                촬영한 영상 불러오기
              </button>
              <input
                ref={file}
                hidden
                type="file"
                accept="video/*,.mov,.mp4,.webm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void receive(f, f.name);
                  e.target.value = "";
                }}
              />
              {target && (
                <button className={s.link} onClick={() => setTarget(null)}>
                  보충 대상 선택 취소
                </button>
              )}
            </div>
            <p className={s.note}>
              원본 영상은 이 기기에 저장됩니다. 분석 시 모든 프레임의 연속
              이미지 묶음과 원본 세부 사진이 OpenAI로 전송됩니다.
            </p>
          </section>
          {session && session.clips.length > 0 && (
            <>
              <section className={s.source} aria-label="원본 영상">
                <div className={s.clipTabs}>
                  {session.clips.map((c, i) => (
                    <button
                      key={c.id}
                      aria-pressed={i === clipIndex}
                      onClick={() => setClipIndex(i)}
                    >
                      {i + 1}. {c.name}
                    </button>
                  ))}
                </div>
                <video
                  ref={video}
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (pendingSeek.current !== null && video.current) {
                      video.current.currentTime = pendingSeek.current;
                      pendingSeek.current = null;
                      void video.current.play().catch(() => {});
                    }
                  }}
                />
                <div className={s.sourceActions}>
                  <button
                    className={s.link}
                    onClick={() =>
                      selected &&
                      download(
                        selected.blob,
                        selected.name.match(/\.(mov|mp4|webm)$/i)
                          ? selected.name
                          : `video-${clipIndex + 1}.${selected.blob.type.includes("mp4") ? "mp4" : "webm"}`,
                      )
                    }
                  >
                    원본 영상 저장
                  </button>
                  <span>
                    {selected?.targetId ? "보충 영상" : "관찰 영상"} ·{" "}
                    {((selected?.blob.size || 0) / 1024 / 1024).toFixed(1)}MB
                  </span>
                </div>
              </section>
              <section className={s.process} aria-label="전체 영상 처리 상태">
                <h2>전체 영상 처리</h2>
                <div className={s.counts}>
                  <p>
                    <strong>
                      {summary?.decoded.toLocaleString() || "—"} /{" "}
                      {summary?.expected.toLocaleString() || "—"}
                    </strong>
                    <span>해독한 원본 프레임</span>
                  </p>
                  <p>
                    <strong>
                      {summary?.done || 0} / {summary?.sheets || "—"}
                    </strong>
                    <span>원본 세부 확인까지 마친 구간</span>
                  </p>
                </div>
                {progress && (
                  <p role="status">
                    {progress.message}
                    {progress.phase === "decode" && progress.total
                      ? ` (${progress.current}/${progress.total})`
                      : ""}
                  </p>
                )}
                {busy ? (
                  <button
                    className={s.secondary}
                    onClick={() => abort.current?.abort()}
                  >
                    분석 잠시 멈추기
                  </button>
                ) : (
                  <button
                    onClick={() => void run()}
                    disabled={summary?.complete}
                  >
                    {summary?.complete
                      ? "전체 시간구간 분석됨"
                      : summary?.decoded
                        ? "미완료 구간 이어서 분석"
                        : "전체 영상 분석 시작"}
                  </button>
                )}
                <p className={s.note}>
                  구간 분석 완료는 모든 제품 면의 확보를 뜻하지 않습니다. 부족
                  항목과 원본 근거를 함께 확인하세요.
                </p>
              </section>
              {selected?.decoded && (
                <details className={s.timeline}>
                  <summary>
                    원본 시간구간 · {selected.decoded.frameCount}프레임
                  </summary>
                  <div>
                    {selected.decoded.sheets.map((sheet) => {
                      const w = selected.windows.find(
                        (w) => w.sheet === sheet.index,
                      );
                      return (
                        <article key={sheet.index}>
                          <button
                            className={s.link}
                            onClick={() => seek(selected.id, sheet.start)}
                          >
                            {sheet.start.toFixed(1)}–{sheet.end.toFixed(1)}초 ·{" "}
                            {sheet.frames.length}프레임 ·{" "}
                            {w?.status === "done"
                              ? "분석됨"
                              : w?.status === "error"
                                ? "재시도 필요"
                                : "대기"}
                          </button>
                          <p>{w?.result?.summary || w?.error}</p>
                          <details>
                            <summary>모든 프레임 보기</summary>
                            <img
                              loading="lazy"
                              src={sheet.image}
                              alt={`${sheet.first}번부터 ${sheet.last}번까지 연속 프레임`}
                            />
                          </details>
                        </article>
                      );
                    })}
                  </div>
                </details>
              )}
              <section className={s.gaps} aria-label="보충할 부분">
                <h2>
                  보충할 부분{" "}
                  <span>
                    {session.gaps.filter((g) => g.status === "open").length}
                  </span>
                </h2>
                {session.gaps.length === 0 ? (
                  <p>
                    {summary?.complete
                      ? "현재 분석에서 특정 부족 항목이 발견되지 않았어요. 아직 보이지 않은 면이 없는지는 직접 확인해주세요."
                      : "분석한 구간에서 부족한 근거를 누적합니다."}
                  </p>
                ) : (
                  [...session.gaps]
                    .sort(
                      (a, b) =>
                        ({ open: 0, deferred: 1, evidence_added: 2 })[
                          a.status
                        ] -
                        { open: 0, deferred: 1, evidence_added: 2 }[b.status],
                    )
                    .map((g) => (
                      <article key={g.id}>
                        <div className={s.gapPhoto}>
                          {gapEvidence(g) ? (
                            <MarkedPhoto
                              image={gapEvidence(g)!.image}
                              box={
                                g.status === "evidence_added"
                                  ? null
                                  : gapEvidence(g)!.box
                              }
                              alt={`${g.label} 근거 사진`}
                            />
                          ) : (
                            <p>
                              아직 관찰되지 않은 부위
                              <br />
                              위치는 미확인
                            </p>
                          )}
                        </div>
                        <div>
                          <h3>
                            {g.label}{" "}
                            <small>
                              {g.status === "evidence_added"
                                ? "보충 근거 추가됨"
                                : g.status === "deferred"
                                  ? "보류"
                                  : g.kind === "not_observed"
                                    ? "미관찰 가설"
                                    : "확인 필요"}
                            </small>
                          </h3>
                          {g.status === "evidence_added" ? (
                            <>
                              <p>
                                이후 구간에서 같은 부위의 선명한 근거를
                                확인했어요.
                              </p>
                              <details>
                                <summary>처음 확인이 필요했던 이유</summary>
                                <p>{g.reason}</p>
                              </details>
                            </>
                          ) : (
                            <>
                              <p>{g.reason}</p>
                              <p className={s.instruction}>{g.instruction}</p>
                            </>
                          )}
                          {g.anchor && g.status !== "evidence_added" && (
                            <button
                              className={s.link}
                              onClick={() =>
                                seek(g.anchor!.clipId, g.anchor!.time)
                              }
                            >
                              근거 원본 {g.anchor.time.toFixed(2)}초 보기
                            </button>
                          )}
                          {g.status !== "evidence_added" && (
                            <div className={s.actions}>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setTarget(g);
                                  window.scrollTo({
                                    top: 0,
                                    behavior: "smooth",
                                  });
                                }}
                              >
                                이 부분 보충하기
                              </button>
                              <button
                                className={s.link}
                                disabled={busy}
                                onClick={() => {
                                  g.status =
                                    g.status === "deferred"
                                      ? "open"
                                      : "deferred";
                                  render();
                                  void saveVideoSession(session).catch((e) =>
                                    setError(e.message),
                                  );
                                }}
                              >
                                {g.status === "deferred" ? "다시 확인" : "보류"}
                              </button>
                            </div>
                          )}
                          {g.support.length > 0 && (
                            <p>
                              {g.support.length}개의 서로 다른 시점에서 보충
                              근거 확인 ·{" "}
                              <button
                                className={s.link}
                                onClick={() =>
                                  seek(
                                    g.support.at(-1)!.clipId,
                                    g.support.at(-1)!.time,
                                  )
                                }
                              >
                                보충 원본 보기
                              </button>
                            </p>
                          )}
                        </div>
                      </article>
                    ))
                )}
              </section>
              <section className={s.inventory}>
                <h2>
                  누적한 제품 정보 <span>{session.regions.length}</span>
                </h2>
                {session.regions.map((r) => (
                  <details key={r.id}>
                    <summary>
                      {r.label} · {stateLabel[r.state] || r.state}{" "}
                      <small>
                        {
                          r.evidence.filter(
                            (e) => e.verified && e.quality === "clear",
                          ).length
                        }
                        개 선명한 근거
                      </small>
                    </summary>
                    <div className={s.evidence}>
                      {r.evidence.map((e, i) => (
                        <article key={i}>
                          <img
                            loading="lazy"
                            src={e.crop}
                            alt={`${r.label} 원본 해상도 크롭`}
                          />
                          <p>{e.detail}</p>
                          <p>
                            {e.verified
                              ? "AI가 같은 부위로 판단"
                              : "같은 부위인지 미확인"}{" "}
                            · {qualityLabel[e.quality]}
                          </p>
                          <button
                            className={s.link}
                            onClick={() => seek(e.clipId, e.time)}
                          >
                            영상 {e.time.toFixed(2)}초 · 프레임 {e.frame}
                          </button>
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
              </section>
              <footer className={s.export}>
                <button disabled={busy} onClick={exportReport}>
                  영상 분석 근거 저장
                </button>
                {planning && (
                  <>
                    <button
                      className={s.secondary}
                      disabled={
                        busy ||
                        !summary?.complete ||
                        !session.regions.some((r) =>
                          r.evidence.some(
                            (e) => e.verified && e.quality === "clear",
                          ),
                        )
                      }
                      onClick={() => void handoff()}
                    >
                      관찰 정보와 근거로 연출 기획
                    </button>
                    <p className={s.note}>
                      기획에는 전체 구간의 누적 관찰 정보·부족 항목과 대표 근거
                      사진을 함께 전달합니다. 원본 영상과 프레임 기록도 이
                      기기에 남습니다.
                    </p>
                  </>
                )}
                <button
                  className={s.link}
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "현재 영상을 저장했나요? 새 제품을 시작하면 이 기기의 현재 관찰 기록이 바뀝니다.",
                      )
                    ) {
                      const next = newSession();
                      setSession(next);
                      setTarget(null);
                      setProgress(null);
                      void saveVideoSession(next).catch((e) =>
                        setError(e.message),
                      );
                    }
                  }}
                >
                  새 제품 관찰 시작
                </button>
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
}
