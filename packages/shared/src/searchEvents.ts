import * as z from "zod";
import { JsonErrorSchema } from "./errors.ts";

export const SseMetaSchema = z.object({
  searchId: z.string().uuid(),
  engine: z.enum(["rg", "none"]),
  searchCount: z.number().int().nonnegative().optional(),
});
export type SseMeta = z.output<typeof SseMetaSchema>;

export const SseHitSchema = z.object({
  path: z.string(), // POSIX relative, never absolute
  line: z.number().int().positive(),
  text: z.string(),
  matches: z.array(
    z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    }),
  ),
});
export type SseHit = z.output<typeof SseHitSchema>;

export const SseDoneSchema = z.object({
  elapsedMs: z.number(),
  matchCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
});
export type SseDone = z.output<typeof SseDoneSchema>;

export const SseErrorSchema = JsonErrorSchema;
export type SseError = z.output<typeof SseErrorSchema>;

export const SseProgressSchema = z.object({
  files: z.number().int().nonnegative(),
  matches: z.number().int().nonnegative(),
});
export type SseProgress = z.output<typeof SseProgressSchema>;

export type SseEvent =
  | { event: "meta"; data: SseMeta }
  | { event: "progress"; data: SseProgress }
  | { event: "hit"; data: SseHit }
  | { event: "done"; data: SseDone }
  | { event: "error"; data: SseError };
