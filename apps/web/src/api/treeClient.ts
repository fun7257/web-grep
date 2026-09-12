import {
  type TreeEntry,
  type TreeListing,
  TreeListingSchema,
} from "@web-grep/shared";
import { apiHeaders } from "./headers.ts";
import { readJsonError, SearchHttpError } from "./searchClient.ts";

export type { TreeEntry, TreeListing };

export async function fetchTree(
  path: string,
  signal: AbortSignal,
): Promise<TreeListing> {
  const params = new URLSearchParams();
  if (path !== "") {
    params.set("path", path);
  }
  const qs = params.toString();
  const res = await fetch(qs === "" ? "/api/tree" : `/api/tree?${qs}`, {
    headers: apiHeaders(),
    signal,
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  const parsed = TreeListingSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "invalid tree response",
    });
  }
  return parsed.data;
}
