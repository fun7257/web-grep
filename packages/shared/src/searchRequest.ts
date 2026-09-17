import * as z from "zod";
import { LIMITS } from "./limits.ts";

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(LIMITS.queryMaxChars),
  path: z.string().max(LIMITS.pathMaxChars).default(""),
  globInclude: z
    .array(z.string().max(LIMITS.globMaxChars))
    .max(LIMITS.globMaxCount)
    .default([]),
  globExclude: z
    .array(z.string().max(LIMITS.globMaxChars))
    .max(LIMITS.globMaxCount)
    .default([]),
  globAnd: z
    .array(z.string().max(LIMITS.globMaxChars))
    .max(LIMITS.globMaxCount)
    .default([]),
  andTerms: z
    .array(
      z.union([
        z.string().min(1).max(LIMITS.queryMaxChars),
        z.object({
          query: z.string().min(1).max(LIMITS.queryMaxChars),
          regex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
          wordMatch: z.boolean().optional(),
        }),
      ]),
    )
    .max(16)
    .default([]),
  regex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  wordMatch: z.boolean().default(false),
  hidden: z.boolean().default(true),
  maxResults: z.number().int().positive().max(LIMITS.maxResultsHard).optional(),
  mtimeAfter: z.number().int().nonnegative().optional(),
});
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;
export type SearchRequest = z.output<typeof SearchRequestSchema>;
