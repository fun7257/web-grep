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
  regex: z.boolean().default(true),
  caseSensitive: z.boolean().default(true),
  wordMatch: z.boolean().default(false),
  hidden: z.boolean().default(false),
  maxResults: z.number().int().positive().max(LIMITS.maxResultsHard).optional(),
});
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;
export type SearchRequest = z.output<typeof SearchRequestSchema>;
