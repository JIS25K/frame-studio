import { correspondenceMessage } from "./handoff";
import { decodeVideo, extractEvidence } from "./decode";
import {
  audit,
  addEvidence,
  addGap,
  compactContext,
  targetContext,
  identity,
} from "./ledger";
import {
  windowOutput,
  detailOutput,
  safeBox,
  type VideoSession,
  type Evidence,
  type Clip,
  type Box,
} from "./schema";
import { saveVideoSession } from "./store";
export type Progress = {
  phase: string;
  current: number;
  total: number;
  message: string;
};
async function ask(body: unknown, signal: AbortSignal) {
  const json = JSON.stringify(body);
  if (new Blob([json]).size > 3_900_000)
    throw new Error(
      "이 구간의 근거 이미지가 요청 한도를 넘었어요. 분석은 미완료로 남겨두었습니다.",
    );
  const r = await fetch("/api/capture/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
    signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "영상 분석 연결 오류");
  return d.output;
}
export async function analyzeSession(
  session: VideoSession,
  onProgress: (p: Progress) => void,
  onChange: () => void,
  signal: AbortSignal,
) {
  const persist = async () => {
    session.updatedAt = new Date().toISOString();
    await saveVideoSession(session);
    onChange();
  };
  for (const clip of session.clips) {
    signal.throwIfAborted();
    if (!clip.decoded) {
      onProgress({
        phase: "decode",
        current: 0,
        total: 0,
        message: `${clip.name}: 모든 프레임 해독 중`,
      });
      clip.decoded = await decodeVideo(
        clip.blob,
        (current, total) =>
          onProgress({
            phase: "decode",
            current,
            total,
            message: "원본의 모든 프레임을 시간순으로 처리하고 있어요.",
          }),
        signal,
      );
      clip.windows = clip.decoded.sheets.map((s) => ({
        sheet: s.index,
        status: "pending",
      }));
      await persist();
    }
    if (!clip.decoded.complete)
      throw new Error(
        `전체 해독을 확인하지 못했어요 (${clip.decoded.frameCount}/${clip.decoded.packetCount}프레임). 부분 결과를 전체 분석으로 처리하지 않았습니다.`,
      );
    if (!session.baseline) {
      session.baseline = (
        await extractEvidence(
          clip.blob,
          clip.decoded.frames[0].time,
          { x: 0, y: 0, width: 1, height: 1 },
          signal,
        )
      ).image;
      await persist();
    }
    for (const sheet of clip.decoded.sheets) {
      signal.throwIfAborted();
      const window = clip.windows.find((w) => w.sheet === sheet.index)!;
      if (window.status === "done" && clip.detailsDone.includes(sheet.index))
        continue;
      const a = audit(session);
      onProgress({
        phase: "analyze",
        current: a.done,
        total: a.sheets,
        message: `${clip.name} · ${sheet.start.toFixed(1)}–${sheet.end.toFixed(1)}초: ${sheet.frames.length}개 연속 프레임 확인`,
      });
      try {
        if (!window.result) {
          const known = compactContext(session.regions);
          const overview = await Promise.all(
            [
              ...new Set([
                sheet.first,
                sheet.frames[Math.floor(sheet.frames.length / 2)],
                sheet.last,
              ]),
            ].map(async (frame) => {
              const source = clip.decoded!.frames[frame];
              const evidence = await extractEvidence(
                clip.blob,
                source.time,
                { x: 0, y: 0, width: 1, height: 1 },
                signal,
              );
              return { frame, time: source.time, image: evidence.image };
            }),
          );
          window.result = windowOutput.parse(
            await ask(
              {
                action: "window",
                sheet: sheet.image,
                overview,
                frames: sheet.frames,
                times: sheet.times,
                baseline: session.baseline,
                known,
                targets: targetContext(
                  [...session.gaps].sort(
                    (a, b) =>
                      Number(b.id === clip.targetId) -
                      Number(a.id === clip.targetId),
                  ),
                ),
              },
              signal,
            ),
          );
          await persist();
        }
        const result = window.result;
        const cache = new Map<string, Evidence>();
        const get = async (frame: number, box: Box) => {
          if (!sheet.frames.includes(frame) || !safeBox(box))
            throw new Error("관찰 근거가 원본 프레임과 맞지 않아요.");
          const key = frame + JSON.stringify(box);
          if (cache.has(key)) return cache.get(key)!;
          const source = clip.decoded!.frames[frame];
          const image = await extractEvidence(
            clip.blob,
            source.time,
            box,
            signal,
          );
          if (Math.abs(image.time - source.time) > 0.08)
            throw new Error("원본 프레임 시간 연결을 확인하지 못했어요.");
          const e: Evidence = {
            clipId: clip.id,
            frame,
            ...image,
            box,
            quality: "uncertain",
            detail: "원본 확인 전",
            trackedPoints: source.points.filter(
              (p) =>
                p.age >= 3 &&
                p.x >= box.x &&
                p.x <= box.x + box.width &&
                p.y >= box.y &&
                p.y <= box.y + box.height,
            ).length,
            verified: false,
          };
          cache.set(key, e);
          return e;
        };
        if (result.sameProduct !== "yes" || !result.productVisible) {
          const e = await get(sheet.first, { x: 0, y: 0, width: 1, height: 1 });
          addGap(
            session,
            {
              key: "product_correspondence",
              label: correspondenceMessage(result.productVisible).label,
              state: "unknown",
              kind: "uncertain",
              frame: sheet.first,
              box: null,
              reason: result.summary,
              instruction: correspondenceMessage(result.productVisible)
                .instruction,
            },
            e,
          );
        } else {
          for (const gap of result.gaps) {
            const anchor = gap.box ? await get(gap.frame, gap.box) : null;
            addGap(session, gap, anchor);
          }
          const items = await Promise.all(
            result.observations.map(async (o, i) => {
              const evidence = await get(o.frame, o.box);
              const prior =
                session.regions
                  .find((r) => r.id === identity(o.key, o.state))
                  ?.evidence.find((e) => e.verified)?.crop || null;
              return {
                id: `${sheet.index}-${i}`,
                o,
                evidence,
                request: {
                  id: `${sheet.index}-${i}`,
                  label: o.label,
                  state: o.state,
                  description: o.description,
                  image: evidence.image,
                  crop: evidence.crop,
                  box: o.box,
                  prior,
                },
              };
            }),
          );
          // Every discovered region is re-read from the original, not just the thumbnails.
          const groups = Array.from(
            { length: Math.ceil(items.length / 2) },
            (_, i) => items.slice(i * 2, i * 2 + 2),
          );
          onProgress({
            phase: "detail",
            current: a.done,
            total: a.sheets,
            message: `${clip.name} · 발견한 부위를 원본 해상도로 재확인`,
          });
          const results = await Promise.allSettled(
            groups.map(async (group) => {
              signal.throwIfAborted();
              if (
                group.every((item) =>
                  window.checks?.some((c) => c.id === item.id),
                )
              )
                return;
              const detail = detailOutput.parse(
                await ask(
                  {
                    action: "detail",
                    baseline: session.baseline,
                    items: group.map((x) => x.request),
                  },
                  signal,
                ),
              );
              if (
                detail.checks.length !== group.length ||
                group.some(
                  (item) =>
                    detail.checks.filter((c) => c.id === item.id).length !== 1,
                )
              )
                throw new Error("세부 검증 응답이 빠졌어요.");
              window.checks = [
                ...(window.checks || []).filter(
                  (c) => !group.some((i) => i.id === c.id),
                ),
                ...detail.checks,
              ];
              await persist();
            }),
          );
          for (const item of items) {
            const check = window.checks?.find((c) => c.id === item.id);
            if (!check) continue;
            const e = {
              ...item.evidence,
              quality: check.quality,
              detail: check.description,
              verified: check.sameRegion === "yes" && check.sameState,
            };
            addEvidence(session, item.o.key, item.o.label, item.o.state, e);
            if (!e.verified || e.quality !== "clear")
              addGap(
                session,
                {
                  key: item.o.key,
                  label: item.o.label,
                  state: item.o.state,
                  kind: e.quality === "clear" ? "uncertain" : e.quality,
                  frame: e.frame,
                  box: e.box,
                  reason: e.detail,
                  instruction:
                    "표시된 부위와 주변 특징을 함께, 더 가까이 선명하게 보여주세요.",
                },
                e,
              );
          }
          const failure = results.find((r) => r.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        }
        if (!clip.detailsDone.includes(sheet.index))
          clip.detailsDone.push(sheet.index);
        window.status = "done";
        delete window.error;
        await persist();
      } catch (e) {
        window.status = "error";
        window.error = (e as Error).message;
        await persist();
        throw e;
      }
    }
  }
  onProgress({
    phase: "done",
    current: audit(session).done,
    total: audit(session).sheets,
    message:
      "전체 시간구간 분석을 마쳤어요. 관찰 근거와 부족한 부분을 확인하세요.",
  });
}
export function newSession(): VideoSession {
  return {
    version: 1,
    id: crypto.randomUUID(),
    clips: [],
    regions: [],
    gaps: [],
    baseline: null,
    updatedAt: new Date().toISOString(),
  };
}
export function addClip(
  session: VideoSession,
  blob: Blob,
  name: string,
  targetId: string | null,
) {
  const c: Clip = {
    id: crypto.randomUUID(),
    name,
    blob,
    targetId,
    decoded: null,
    windows: [],
    detailsDone: [],
  };
  session.clips.push(c);
  return c;
}
