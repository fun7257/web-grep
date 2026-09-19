import * as z from "zod";
import { LIMITS } from "./limits.ts";

export const FileQuerySchema = z.object({
  path: z.string().min(1).max(LIMITS.pathMaxChars),
  line: z.number().int().positive(),
  before: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.beforeAfterMax)
    .default(LIMITS.beforeAfterDefault),
  after: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.beforeAfterMax)
    .default(LIMITS.beforeAfterDefault),
});
export type FileQueryInput = z.input<typeof FileQuerySchema>;
export type FileQuery = z.output<typeof FileQuerySchema>;

export const FileSliceQuerySchema = z.object({
  path: z.string().min(1).max(LIMITS.pathMaxChars),
  from: z.number().int().positive().optional(),
  count: z
    .number()
    .int()
    .positive()
    .max(LIMITS.previewChunkMax)
    .optional(),
  line: z.number().int().positive().optional(),
  tail: z.boolean().optional(),
});
export type FileSliceQuery = z.output<typeof FileSliceQuerySchema>;

export const FileWindowResponseSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  lineCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  binary: z.boolean(),
  eof: z.boolean().optional().default(false),
  lines: z.array(
    z.object({
      n: z.number().int().positive(),
      text: z.string(),
    }),
  ),
});
export type FileWindowResponse = z.output<typeof FileWindowResponseSchema>;
