import * as z from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  engine: z.enum(["rg", "none"]),
});
export type HealthResponse = z.output<typeof HealthResponseSchema>;

export const MetaResponseSchema = z.object({
  engine: z.enum(["rg", "none"]),
  rgVersion: z.string().nullable(),
  rootLabel: z.string(),
  root: z.string(),
  followSymlinks: z.boolean(),
  limits: z.object({
    maxResults: z.number(),
    maxResultsHard: z.number(),
    timeoutMs: z.number(),
    previewBytes: z.number(),
    previewLines: z.number(),
    queryMaxChars: z.number(),
  }),
  defaultLocale: z.literal("zh-CN"),
  authRequired: z.boolean(),
  searchCount: z.number().int().nonnegative().optional().default(0),
});
export type MetaResponse = z.output<typeof MetaResponseSchema>;
