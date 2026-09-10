import * as z from "zod";

export const MetaResponseSchema = z.object({
  engine: z.enum(["rg", "literal", "none"]),
  rgVersion: z.string().nullable(),
  rootLabel: z.string(),
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
});
export type MetaResponse = z.output<typeof MetaResponseSchema>;
