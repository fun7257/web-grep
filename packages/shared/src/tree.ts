import * as z from "zod";
import { LIMITS } from "./limits.ts";

export const TreeQuerySchema = z.object({
  path: z.string().max(LIMITS.pathMaxChars).default(""),
  mtimeAfter: z.number().int().nonnegative().optional(),
});
export type TreeQuery = z.output<typeof TreeQuerySchema>;

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
