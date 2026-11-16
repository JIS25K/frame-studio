import { z } from "zod";
export const boxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
export const qualitySchema = z.enum([
  "clear",
  "blurred",
  "occluded",
  "too_small",
  "uncertain",
]);
export const configurationSchema = z.enum([
  "closed",
  "open",
  "fixed",
  "unknown",
]);
export const observation = z.object({
  key: z.string().min(1).max(80),
  label: z.string().max(100),
  state: configurationSchema,
  frame: z.number().int().nonnegative(),
  box: boxSchema,
  quality: qualitySchema,
  description: z.string().max(400),
});
export const gap = z.object({
  key: z.string().min(1).max(80),
  label: z.string().max(100),
  kind: z.enum([
    "not_observed",
    "blurred",
    "occluded",
    "too_small",
    "uncertain",
  ]),
  state: configurationSchema,
  frame: z.number().int().nonnegative(),
  box: boxSchema.nullable(),
  reason: z.string().max(400),
  instruction: z.string().max(250),
});
export const windowOutput = z.object({
  productVisible: z.boolean(),
  sameProduct: z.enum(["yes", "no", "uncertain"]),
  summary: z.string().max(500),
  observations: z.array(observation).max(6),
  gaps: z.array(gap).max(6),
});
export const detailOutput = z.object({
  checks: z
    .array(
      z.object({
        id: z.string().max(100),
        quality: qualitySchema,
        sameRegion: z.enum(["yes", "no", "uncertain"]),
        sameState: z.boolean(),
        description: z.string().max(500),
      }),
    )
    .max(6),
});
export type Box = z.infer<typeof boxSchema>;
export type WindowObservation = z.infer<typeof windowOutput>;
export type DetailResult = z.infer<typeof detailOutput>;
export type FrameRecord = {
  index: number;
  time: number;
  duration: number;
  sharpness: number;
  brightness: number;
  change: number;
  tracked: number;
  points: { id: number; x: number; y: number; age: number }[];
};
export type Filmstrip = {
  index: number;
  first: number;
  last: number;
  start: number;
  end: number;
  frames: number[];
  times: number[];
  image: string;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
};
export type DecodedVideo = {
  frameCount: number;
  packetCount: number;
  duration: number;
  width: number;
  height: number;
  complete: boolean;
  frames: FrameRecord[];
  sheets: Filmstrip[];
};
export type Evidence = {
  clipId: string;
  frame: number;
  time: number;
  image: string;
  crop: string;
  box: Box;
  quality: z.infer<typeof qualitySchema>;
  detail: string;
  trackedPoints: number;
  verified: boolean;
};
export type Region = {
  id: string;
  key: string;
  label: string;
  state: string;
  evidence: Evidence[];
};
export type Gap = {
  id: string;
  key: string;
  label: string;
  state: string;
  kind: z.infer<typeof gap>["kind"];
  reason: string;
  instruction: string;
  anchor: Evidence | null;
  status: "open" | "evidence_added" | "deferred";
  support: Evidence[];
};
export type Clip = {
  id: string;
  name: string;
  blob: Blob;
  targetId: string | null;
  decoded: DecodedVideo | null;
  windows: {
    sheet: number;
    status: "pending" | "done" | "error";
    result?: WindowObservation;
    checks?: DetailResult["checks"];
    error?: string;
  }[];
  detailsDone: number[];
};
export type VideoSession = {
  version: 1;
  id: string;
  clips: Clip[];
  regions: Region[];
  gaps: Gap[];
  baseline: string | null;
  updatedAt: string;
};
export const VIDEO_LIMITS = {
  maxBytes: 200 * 1024 * 1024,
  maxSeconds: 180,
  maxFrames: 12000,
  framesPerSheet: 48,
  maxRegions: 48,
  maxGaps: 48,
};
export function safeBox(b: Box): Box | null {
  return b.x + b.width <= 1.001 && b.y + b.height <= 1.001 ? b : null;
}
