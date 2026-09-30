import type { SearchRequestInput } from "@web-grep/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { isAbortError, SearchHttpError } from "../api/http.ts";
import { streamSearch } from "../api/searchClient.ts";
import {
  initialSearchState,
  type SearchState,
  searchReducer,
} from "../state/searchReducer.ts";

export type UseSearch = SearchState & {
  searchCount: number;
  submit: (input: SearchRequestInput) => void;
  cancel: () => void;
  reset: () => void;
};

export function useSearch(opts?: {
  onAuthFailure?: (err: SearchHttpError) => void;
}): UseSearch {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const onAuthFailureRef = useRef(opts?.onAuthFailure);
  useEffect(() => {
    onAuthFailureRef.current = opts?.onAuthFailure;
  }, [opts?.onAuthFailure]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "search/reset" });
  }, []);

  const submit = useCallback((input: SearchRequestInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;
    dispatch({ type: "search/start" });

    void (async () => {
      let sawTerminal = false;
      let streamStarted = false;
      try {
        for await (const event of streamSearch(input, ac.signal)) {
          if (gen !== genRef.current) {
            return;
          }
          if (!streamStarted) {
            streamStarted = true;
            dispatch({ type: "search/stream" });
          }
          if (event.event === "meta") {
            dispatch({ type: "search/meta", meta: event.data });
          } else if (event.event === "progress") {
            dispatch({ type: "search/progress", progress: event.data });
          } else if (event.event === "hit") {
            dispatch({ type: "search/hit", hit: event.data });
          } else if (event.event === "done") {
            sawTerminal = true;
            dispatch({ type: "search/done", done: event.data });
          } else if (event.event === "error") {
            sawTerminal = true;
            dispatch({ type: "search/error", error: event.data });
          }
        }
        if (gen !== genRef.current || sawTerminal) {
          return;
        }
        if (ac.signal.aborted) {
          dispatch({ type: "search/cancelled" });
          return;
        }
        dispatch({
          type: "search/error",
          error: { code: "INTERNAL", message: "search failed" },
        });
      } catch (err) {
        if (gen !== genRef.current) {
          return;
        }
        if (ac.signal.aborted || isAbortError(err)) {
          dispatch({ type: "search/cancelled" });
          return;
        }
        if (err instanceof SearchHttpError) {
          onAuthFailureRef.current?.(err);
          dispatch({
            type: "search/error",
            error: err.body,
            beforeStream: true,
          });
          return;
        }
        dispatch({
          type: "search/error",
          error: { code: "INTERNAL", message: "search failed" },
        });
      }
    })();
  }, []);

  return { ...state, submit, cancel, reset };
}
