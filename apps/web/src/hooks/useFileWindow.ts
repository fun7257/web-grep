import { useCallback, useRef, useState } from "react";
import { fetchFileWindow, PREVIEW_CHUNK } from "../api/fileClient.ts";
import { SearchHttpError } from "../api/searchClient.ts";
import { mergeLines, type WindowLine } from "../fileWindow.ts";
import type { Translate } from "../i18n/index.ts";

type FetchQuery = {
  path: string;
  from?: number;
  count?: number;
  tail?: boolean;
};

export function useFileWindow(t: Translate) {
  const [lines, setLines] = useState<WindowLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [eof, setEof] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const pathRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setLines([]);
    setError(null);
    setErrorCode(null);
    setBinary(false);
    setEof(false);
    setLoading(false);
    loadingRef.current = false;
  }, []);

  const loadSlice = useCallback(
    async (
      query: FetchQuery,
      opts: {
        mode: "replace" | "merge";
        dir?: "up" | "down";
        signal?: AbortSignal;
      },
    ): Promise<WindowLine[] | null> => {
      const openedPath = query.path;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const win = await fetchFileWindow(
          { ...query, count: query.count ?? PREVIEW_CHUNK },
          opts.signal,
        );
        if (pathRef.current !== openedPath) {
          return null;
        }
        if (win.binary) {
          setBinary(true);
          if (opts.mode === "replace") {
            setLines([]);
            setEof(true);
          }
          return [];
        }
        setBinary(false);
        if (opts.mode === "replace") {
          setLines(win.lines);
          setEof(win.eof === true || win.lines.length === 0);
          return win.lines;
        }
        let lastN = 0;
        let merged: WindowLine[] = [];
        setLines((current) => {
          lastN = current[current.length - 1]?.n ?? 0;
          merged = mergeLines(current, win.lines);
          return merged;
        });
        if (opts.dir === "down") {
          const grew = win.lines.some((line) => line.n > lastN);
          setEof(win.eof === true || !grew);
        }
        return merged;
      } catch (err: unknown) {
        if (opts.signal?.aborted === true || pathRef.current !== openedPath) {
          return null;
        }
        if (err instanceof SearchHttpError) {
          setError(err.body.message);
          setErrorCode(err.body.code);
        } else {
          setError(t("searchFailed"));
          setErrorCode(null);
        }
        return null;
      } finally {
        if (pathRef.current === openedPath) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [t],
  );

  return {
    lines,
    setLines,
    error,
    errorCode,
    binary,
    eof,
    loading,
    loadingRef,
    pathRef,
    reset,
    loadSlice,
  };
}
