import {
  type TreeEntry,
  type TreeListing,
  TreeListingSchema,
} from "@web-grep/shared";
import { apiUrl } from "./base.ts";
import { apiHeaders } from "./headers.ts";
import { readJsonError, SearchHttpError } from "./searchClient.ts";

export type { TreeEntry, TreeListing };

function applyTreeFilter(
  params: URLSearchParams,
  mtimeAfter?: number,
  exclude: string[] = [],
): void {
  for (const glob of exclude) {
    params.append("exclude", glob);
  }
  if (mtimeAfter !== undefined) {
    params.set("mtimeAfter", String(mtimeAfter));
  }
}

export async function fetchTree(
  path: string,
  signal: AbortSignal,
  mtimeAfter?: number | undefined,
  exclude: string[] = [],
): Promise<TreeListing> {
  const params = new URLSearchParams();
  if (path !== "") {
    params.set("path", path);
  }
  applyTreeFilter(params, mtimeAfter, exclude);
  const qs = params.toString();
  const res = await fetch(apiUrl(qs === "" ? "/api/tree" : `/api/tree?${qs}`), {
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

export async function fetchFileCount(
  path: string,
  signal: AbortSignal,
  mtimeAfter?: number | undefined,
  exclude: string[] = [],
): Promise<number> {
  const params = new URLSearchParams();
  if (path !== "") {
    params.set("path", path);
  }
  applyTreeFilter(params, mtimeAfter, exclude);
  const qs = params.toString();
  const res = await fetch(apiUrl(qs === "" ? "/api/count" : `/api/count?${qs}`), {
    headers: apiHeaders(),
    signal,
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("count" in body) ||
    typeof (body as { count: unknown }).count !== "number"
  ) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "invalid count response",
    });
  }
  return (body as { count: number }).count;
}
