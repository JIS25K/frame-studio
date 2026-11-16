import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from "mediabunny";
import {
  grayPixels,
  measure,
  seedPoints,
  trackPoints,
  type Point,
} from "./metrics";
import {
  VIDEO_LIMITS,
  type DecodedVideo,
  type Filmstrip,
  type FrameRecord,
  type Box,
} from "./schema";
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
export async function decodeVideo(
  blob: Blob,
  onProgress: (n: number, total: number) => void,
  signal: AbortSignal,
): Promise<DecodedVideo> {
  if (blob.size > VIDEO_LIMITS.maxBytes)
    throw new Error(
      "영상이 200MB를 넘어요. 원본을 보존한 채 여러 영상으로 나눠주세요.",
    );
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new Error(
        "이 기기에서 영상 코덱을 해독하지 못해요. 최신 Safari/Chrome 또는 H.264 MP4를 사용해주세요. 일부 사진으로 대체하지 않았습니다.",
      );
    const duration = await track.computeDuration();
    const stats = await track.computePacketStats();
    if (
      duration > VIDEO_LIMITS.maxSeconds ||
      stats.packetCount > VIDEO_LIMITS.maxFrames
    )
      throw new Error(
        "한 번에 3분·12,000프레임까지 처리해요. 영상을 나눠 추가해주세요. 뒷부분을 생략하지 않았습니다.",
      );
    const frames: FrameRecord[] = [],
      sheets: Filmstrip[] = [];
    const small = canvas(96, 96),
      ctx = small.getContext("2d", { willReadFrequently: true })!;
    const columns = 8,
      rows = 6,
      tileWidth = 192,
      tileHeight = 216;
    const sheetCanvas = canvas(columns * tileWidth, rows * tileHeight),
      sheetCtx = sheetCanvas.getContext("2d")!;
    let previous: Uint8Array | null = null,
      points: Point[] = [],
      nextId = 0,
      indices: number[] = [],
      times: number[] = [],
      firstTime = 0,
      width = 0,
      height = 0,
      lastEnd = 0;
    const flush = () => {
      if (!indices.length) return;
      sheets.push({
        index: sheets.length,
        first: indices[0],
        last: indices.at(-1)!,
        start: times[0],
        end: lastEnd,
        frames: [...indices],
        times: [...times],
        image: sheetCanvas.toDataURL("image/jpeg", 0.86),
        columns,
        rows,
        tileWidth,
        tileHeight,
      });
      indices = [];
      times = [];
      sheetCtx.fillStyle = "#111827";
      sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    };
    sheetCtx.fillStyle = "#111827";
    sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    for await (const sample of new VideoSampleSink(track).samples()) {
      try {
        signal.throwIfAborted();
        const index = frames.length;
        const time = sample.timestamp;
        if (!index) firstTime = time;
        width = sample.displayWidth;
        height = sample.displayHeight;
        sample.draw(ctx, 0, 0, 96, 96);
        const g = grayPixels(ctx.getImageData(0, 0, 96, 96).data);
        const m = measure(g, previous, 96, 96);
        points = previous ? trackPoints(previous, g, 96, 96, points) : [];
        const tracked = points.length;
        if (points.length < 12) {
          const seeds = seedPoints(g, 96, 96, nextId);
          nextId += seeds.length;
          points = [
            ...points,
            ...seeds.filter((p) =>
              points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 8),
            ),
          ].slice(0, 24);
        }
        frames.push({
          index,
          time,
          duration: sample.duration,
          ...m,
          tracked,
          points: points.map((p) => ({ ...p, x: p.x / 96, y: p.y / 96 })),
        });
        previous = g;
        const slot = indices.length,
          x = (slot % columns) * tileWidth,
          y = Math.floor(slot / columns) * tileHeight,
          scale = Math.min(tileWidth / width, (tileHeight - 24) / height);
        sample.draw(
          sheetCtx,
          x + (tileWidth - width * scale) / 2,
          y + (tileHeight - 24 - height * scale) / 2,
          width * scale,
          height * scale,
        );
        sheetCtx.fillStyle = "white";
        sheetCtx.font = "14px sans-serif";
        sheetCtx.fillText(
          `#${index}  ${time.toFixed(2)}s`,
          x + 5,
          y + tileHeight - 7,
        );
        indices.push(index);
        times.push(time);
        lastEnd = time + sample.duration;
        if (indices.length === VIDEO_LIMITS.framesPerSheet) flush();
        if (index % 8 === 0) {
          onProgress(frames.length, stats.packetCount);
          await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        sample.close();
      }
    }
    flush();
    onProgress(frames.length, stats.packetCount);
    return {
      frameCount: frames.length,
      packetCount: stats.packetCount,
      duration,
      width,
      height,
      complete:
        frames.length === stats.packetCount &&
        frames.length > 0 &&
        lastEnd >= duration - 0.15 &&
        firstTime < 0.15,
      frames,
      sheets,
    };
  } finally {
    input.dispose();
  }
}
export async function extractEvidence(
  blob: Blob,
  at: number,
  box: Box,
  signal: AbortSignal,
) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("원본 영상 트랙이 없어요.");
    const sample = await new VideoSampleSink(track).getSample(at + 0.00001);
    if (!sample) throw new Error("지정한 원본 프레임을 다시 읽지 못했어요.");
    try {
      const w = sample.displayWidth,
        h = sample.displayHeight;
      const c = canvas(
        Math.round(w * Math.min(1, 1280 / w, 1280 / h)),
        Math.round(h * Math.min(1, 1280 / w, 1280 / h)),
      );
      sample.draw(c.getContext("2d")!, 0, 0, c.width, c.height);
      const cw = Math.max(1, Math.round(w * box.width)),
        ch = Math.max(1, Math.round(h * box.height)),
        scale = Math.min(1, 1024 / cw, 1024 / ch);
      const crop = canvas(
        Math.max(1, Math.round(cw * scale)),
        Math.max(1, Math.round(ch * scale)),
      );
      sample.draw(
        crop.getContext("2d")!,
        w * box.x,
        h * box.y,
        cw,
        ch,
        0,
        0,
        crop.width,
        crop.height,
      );
      return {
        image: c.toDataURL("image/jpeg", 0.88),
        crop: crop.toDataURL("image/jpeg", 0.92),
        time: sample.timestamp,
      };
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}
