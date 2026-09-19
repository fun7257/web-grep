import * as z from "zod";
import { LIMITS } from "./limits.ts";

const globList = z
  .array(z.string().max(LIMITS.globMaxChars))
  .max(LIMITS.globMaxCount);

export const TreeQuerySchema = z.object({
  path: z.string().max(LIMITS.pathMaxChars).default(""),
  mtimeAfter: z.number().int().nonnegative().optional(),
  /** Repeated `exclude=` query params; current UI already sends these. */
  exclude: globList.optional().default([]),
  /** Repeated `include=` query params. Optional — current UI does not send it. */
  include: globList.optional(),
});
export type TreeQuery = z.output<typeof TreeQuerySchema>;

/** Same filters as `/api/tree` (`path`, `mtimeAfter`, `exclude`, `include`). */
export const CountQuerySchema = TreeQuerySchema;
export type CountQuery = TreeQuery;

export const CountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type CountResponse = z.output<typeof CountResponseSchema>;

export const TreeEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string(),
  dir: z.boolean(),
});
export type TreeEntry = z.output<typeof TreeEntrySchema>;

export const TreeListingSchema = z.object({
  path: z.string(),
  entries: z.array(TreeEntrySchema),
  truncated: z.boolean(),
});
export type TreeListing = z.output<typeof TreeListingSchema>;
