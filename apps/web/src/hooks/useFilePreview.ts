import type { FileWindowResponse, JsonError, SseHit } from "@web-grep/shared";
import { useEffect, useRef, useState } from "react";
import { fetchFileWindow } from "../api/fileClient.ts";
import { SearchHttpError } from "../api/searchClient.ts";

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export type FilePreviewState = {
  window: FileWindowResponse | null;
  error: JsonError | null;
  loading: boolean;
};

type FetchedPreview = {
  path: string;
  line: number;
  window: FileWindowResponse | null;
  error: JsonError | null;
};

export function useFilePreview(
  hit: SseHit | null,
  opts?: { onAuthFailure?: (err: SearchHttpError) => void },
): FilePreviewState {
  const [fetched, setFetched] = useState<FetchedPreview | null>(null);
  const genRef = useRef(0);
  const onAuthFailureRef = useRef(opts?.onAuthFailure);
  useEffect(() => {
    onAuthFailureRef.current = opts?.onAuthFailure;
  }, [opts?.onAuthFailure]);

  const path = hit?.path;
  const line = hit?.line;

  useEffect(() => {
    if (path === undefined || line === undefined) {
      return;
    }
    const ac = new AbortController();
    const gen = ++genRef.current;
    void (async () => {
      try {
        const data = await fetchFileWindow({ path, line }, ac.signal);
        if (gen !== genRef.current || ac.signal.aborted) {
          return;
        }
        setFetched({ path, line, window: data, error: null });
      } catch (err) {
        if (gen !== genRef.current || ac.signal.aborted || isAbortError(err)) {
          return;
        }
        if (err instanceof SearchHttpError) {
          onAuthFailureRef.current?.(err);
          setFetched({ path, line, window: null, error: err.body });
          return;
        }
        setFetched({
          path,
          line,
          window: null,
          error: { code: "INTERNAL", message: "preview failed" },
        });
      }
    })();
    return () => {
      ac.abort();
    };
  }, [line, path]);

  if (path === undefined || line === undefined) {
    return { window: null, error: null, loading: false };
  }
  if (fetched === null || fetched.path !== path || fetched.line !== line) {
    return { window: null, error: null, loading: true };
  }
  return { window: fetched.window, error: fetched.error, loading: false };
}
