import { z } from "zod";
// Text evidence retains the complete cumulative video inventory alongside visual anchors.
export const videoContextSchema = z.object({
  sessionId: z.string().uuid(),
  decodedFrames: z.number().int().nonnegative(),
  processedWindows: z.number().int().nonnegative(),
  clips: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(300),
        duration: z.number().nonnegative(),
        frames: z.number().int().nonnegative(),
      }),
    )
    .max(100),
  regions: z
    .array(
      z.object({
        key: z.string().max(80),
        label: z.string().max(100),
        state: z.string().max(60),
        evidence: z
          .array(
            z.object({
              clipId: z.string(),
              time: z.number().nonnegative(),
              frame: z.number().int().nonnegative(),
              quality: z.string().max(30),
              verified: z.boolean(),
              detail: z.string().max(500),
            }),
          )
          .max(12000),
      }),
    )
    .max(48),
  gaps: z
    .array(
      z.object({
        key: z.string().max(80),
        label: z.string().max(100),
        state: z.string().max(60),
        reason: z.string().max(400),
        instruction: z.string().max(250),
        status: z.enum(["open", "evidence_added", "deferred"]),
      }),
    )
    .max(48),
});
export type VideoContext = z.infer<typeof videoContextSchema>;
