"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { grayPixels, measure } from "@/lib/video-capture/metrics";
import s from "./video-studio.module.css";
export function VideoRecorder({
  target,
  onDone,
  onCancel,
}: {
  target: string;
  onDone: (blob: Blob, baseline: string | null) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    media = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    parts = useRef<Blob[]>([]),
    active = useRef(true),
    finish = useRef(false),
    finalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [recording, setRecording] = useState(false),
    [finalizing, setFinalizing] = useState(false),
    [seconds, setSeconds] = useState(0),
    [paused, setPaused] = useState(false),
    [hasData, setHasData] = useState(false),
    [baseline, setBaseline] = useState<string | null>(null),
    [direction, setDirection] = useState<"right" | "left">("right"),
    [motion, setMotion] = useState(
      "한 바퀴에 20–30초. 4초마다 조금씩 돌려주세요.",
    );
  useEffect(() => {
    active.current = true;
    void navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
        audio: false,
      })
      .then((stream) => {
        if (!active.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        media.current = stream;
        if (video.current) {
          video.current.srcObject = stream;
          void video.current
            .play()
            .catch(() => setError("카메라 미리보기를 시작하지 못했어요."));
        }
        stream.getTracks().forEach((t) =>
          t.addEventListener("ended", () => {
            if (active.current && !finish.current) {
              setError("카메라가 끊겼어요. 촬영한 영상을 마무리해주세요.");
              setPaused(true);
            }
          }),
        );
      })
      .catch(() =>
        setError(
          "카메라 권한을 확인해주세요. 저장된 영상을 불러올 수도 있어요.",
        ),
      );
    if (!navigator.mediaDevices)
      setError(
        "카메라를 지원하지 않는 환경이에요. 저장된 영상을 불러와주세요.",
      );
    const visibility = () => {
      if (document.hidden && recorder.current?.state === "recording") {
        recorder.current.pause();
        setPaused(true);
        setError("화면을 벗어나 녹화를 잠시 멈췄어요.");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const stream = media,
      rec = recorder,
      timer = finalizeTimer;
    return () => {
      active.current = false;
      document.removeEventListener("visibilitychange", visibility);
      if (timer.current) clearTimeout(timer.current);
      if (rec.current && rec.current.state !== "inactive") rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!recording || paused) return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording, paused]);
  useEffect(() => {
    if (seconds >= 175 && recorder.current?.state === "recording") {
      recorder.current.pause();
      setPaused(true);
      setError(
        "한 영상의 길이 한도에 가까워 녹화를 멈춰두었어요. 마무리한 뒤 영상을 추가해주세요.",
      );
    }
  }, [seconds]);
  useEffect(() => {
    if (!recording || paused) return;
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    let prev: Uint8Array | null = null;
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      ctx.drawImage(v, 0, 0, 96, 96);
      const g = grayPixels(ctx.getImageData(0, 0, 96, 96).data),
        m = measure(g, prev, 96, 96);
      prev = g;
      setMotion(
        m.change > 0.085
          ? "화면 변화가 커요. 조금 더 천천히 돌려주세요."
          : m.sharpness < 70
            ? "화면이 흐려요. 잠깐 멈춰 초점을 맞춰주세요."
            : "좋아요. 한 바퀴에 20–30초 정도로 천천히 돌려주세요.",
      );
    }, 400);
    return () => clearInterval(timer);
  }, [recording, paused]);
  function start() {
    try {
      if (!media.current || !video.current) return;
      const v = video.current,
        c = document.createElement("canvas");
      c.width = 480;
      c.height = Math.round((480 * v.videoHeight) / v.videoWidth);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const front = c.toDataURL("image/jpeg", 0.85);
      setBaseline(front);
      const mime = ["video/mp4", "video/webm;codecs=vp8", "video/webm"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(media.current, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 4_000_000,
      });
      recorder.current = rec;
      parts.current = [];
      finish.current = false;
      setHasData(false);
      setSeconds(0);
      setPaused(false);
      rec.ondataavailable = (e) => {
        if (e.data.size) {
          parts.current.push(e.data);
          if (active.current) setHasData(true);
        }
      };
      rec.onerror = () => {
        if (active.current) {
          setError(
            "녹화 오류가 발생했어요. 모인 영상을 마무리하거나 원본 파일을 불러와주세요.",
          );
          setPaused(true);
        }
      };
      rec.onstop = () => {
        if (finalizeTimer.current) clearTimeout(finalizeTimer.current);
        if (!active.current) return;
        setRecording(false);
        setFinalizing(false);
        const blob = new Blob(parts.current, { type: rec.mimeType });
        if (finish.current && blob.size) {
          media.current?.getTracks().forEach((t) => t.stop());
          onDone(blob, front);
        } else setError("녹화가 중단됐어요. 모인 영상을 마무리할 수 있어요.");
      };
      rec.start(1000);
      setRecording(true);
      setError("");
    } catch {
      setError(
        "이 브라우저에서 녹화하지 못했어요. 휴대전화 카메라로 촬영한 영상을 불러와주세요.",
      );
    }
  }
  function stop() {
    if (finalizing) return;
    finish.current = true;
    setFinalizing(true);
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
      finalizeTimer.current = setTimeout(() => {
        if (active.current) {
          setFinalizing(false);
          setRecording(false);
          setError(
            "영상 마무리가 지연돼요. 마무리 버튼을 다시 눌러 모인 영상을 보관해주세요.",
          );
        }
      }, 8000);
    } else {
      const blob = new Blob(parts.current, {
        type: rec?.mimeType || "video/mp4",
      });
      if (blob.size) onDone(blob, baseline);
      else {
        setFinalizing(false);
        setError("저장된 영상이 없어요. 다시 촬영해주세요.");
      }
    }
  }
  return (
    <section className={s.recorder}>
      <header>
        <strong>{recording ? "전체 영상 녹화" : "기준 정면 잡기"}</strong>
        <span>
          {seconds}초{paused ? " · 일시정지" : ""}
        </span>
      </header>
      <div className={s.camera}>
        <video
          ref={video}
          muted
          autoPlay
          playsInline
          onLoadedData={() => setReady(true)}
        />
        {baseline && (
          <figure className={s.baseline}>
            <img src={baseline} alt="처음 정한 기준 정면" />
            <figcaption>기준 정면</figcaption>
          </figure>
        )}
      </div>
      <div className={s.recordControls}>
        <p>
          {target ||
            `앞으로 삼을 면을 보여준 뒤, 그 면이 화면 ${direction === "right" ? "오른쪽 →" : "왼쪽 ←"}으로 돌아가게 돌려주세요.`}
        </p>
        {!recording && !hasData && (
          <div className={s.direction}>
            <button
              aria-pressed={direction === "left"}
              onClick={() => setDirection("left")}
            >
              ← 왼쪽으로
            </button>
            <button
              aria-pressed={direction === "right"}
              onClick={() => setDirection("right")}
            >
              오른쪽으로 →
            </button>
          </div>
        )}
        {recording && (
          <>
            <p role="status">{motion}</p>
            <p>
              위·아래와 작은 연결부도 보여주세요. 직접 마무리할 때까지 이 화면에
              머뭅니다.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {paused && recording && seconds < 175 && (
          <button
            onClick={() => {
              if (recorder.current?.state === "paused") {
                recorder.current.resume();
                setPaused(false);
                setError("");
              }
            }}
          >
            녹화 계속
          </button>
        )}
        {recording || hasData ? (
          <button disabled={finalizing} onClick={stop}>
            {finalizing ? "영상 마무리 중…" : "녹화 마치고 전체 영상 확인"}
          </button>
        ) : (
          <button disabled={!ready} onClick={start}>
            이 정면으로 녹화 시작
          </button>
        )}
        <button
          className={s.secondary}
          disabled={finalizing}
          onClick={() => {
            if (
              !(recording || hasData) ||
              confirm("촬영 중인 영상을 버리고 돌아갈까요?")
            )
              onCancel();
          }}
        >
          돌아가기
        </button>
      </div>
    </section>
  );
}
