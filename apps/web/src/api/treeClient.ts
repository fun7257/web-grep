import {
  type TreeEntry,
  type TreeListing,
  TreeListingSchema,
} from "@web-grep/shared";
import {
  abortableSleep,
  fetchJson,
  isAbortError,
  SearchHttpError,
} from "./http.ts";

export type { TreeEntry, TreeListing };

export const ROOT_TREE_MAX_ATTEMPTS = 16;
export const ROOT_TREE_RETRY_MS = 250;

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

function treePath(
  apiPath: "/api/tree",
  path: string,
  mtimeAfter?: number,
  exclude: string[] = [],
): string {
  const params = new URLSearchParams();
  if (path !== "") {
    params.set("path", path);
  }
  applyTreeFilter(params, mtimeAfter, exclude);
  const qs = params.toString();
  return qs === "" ? apiPath : `${apiPath}?${qs}`;
}

export async function fetchTree(
  path: string,
  signal: AbortSignal,
  mtimeAfter?: number,
  exclude: string[] = [],
): Promise<TreeListing> {
  const parsed = TreeListingSchema.safeParse(
    await fetchJson(treePath("/api/tree", path, mtimeAfter, exclude), {
      signal,
    }),
  );
  if (!parsed.success) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "invalid tree response",
    });
  }
  return parsed.data;
}

export type RootTreeResult =
  | { ok: true; listing: TreeListing }
  | { ok: false; kind: "aborted" }
  | { ok: false; kind: "auth"; err: SearchHttpError }
  | { ok: false; kind: "failed" };

export async function fetchRootTreeRetry(
  signal: AbortSignal,
  mtimeAfter: number | undefined,
  exclude: string[],
  onAttemptError?: (err: unknown) => void,
  opts?: {
    maxAttempts?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<RootTreeResult> {
  const maxAttempts = opts?.maxAttempts ?? ROOT_TREE_MAX_ATTEMPTS;
  const sleep = opts?.sleep ?? abortableSleep;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal.aborted) {
      return { ok: false, kind: "aborted" };
    }
    try {
      const listing = await fetchTree("", signal, mtimeAfter, exclude);
      if (signal.aborted) {
        return { ok: false, kind: "aborted" };
      }
      return { ok: true, listing };
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        return { ok: false, kind: "aborted" };
      }
      onAttemptError?.(err);
      if (err instanceof SearchHttpError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, kind: "auth", err };
        }
      }
      try {
        await sleep(ROOT_TREE_RETRY_MS, signal);
      } catch (sleepErr) {
        if (signal.aborted || isAbortError(sleepErr)) {
          return { ok: false, kind: "aborted" };
        }
        throw sleepErr;
      }
    }
  }
  return { ok: false, kind: "failed" };
}
