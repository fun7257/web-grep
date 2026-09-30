import type {
  JsonError,
  SseDone,
  SseHit,
  SseMeta,
  SseProgress,
} from "@web-grep/shared";

export type SearchStatus = "idle" | "running" | "done" | "cancelled" | "error";

export type SearchState = {
  status: SearchStatus;
  hits: SseHit[];
  meta: SseMeta | null;
  done: SseDone | null;
  error: JsonError | null;
  /**
   * True when the error came back as an HTTP response before the stream
   * opened (preflight: BUSY, ENGINE, INVALID_*), false when it ended an
   * open stream. An ENGINE error before the stream means there is no rg; one
   * inside the stream is just that search failing.
   */
  errorBeforeStream: boolean;
  progress: SseProgress | null;
  searchCount: number;
};

export type SearchAction =
  | { type: "search/start" }
  | { type: "search/stream" }
  | { type: "search/meta"; meta: SseMeta }
  | { type: "search/progress"; progress: SseProgress }
  | { type: "search/hit"; hit: SseHit }
  | { type: "search/done"; done: SseDone }
  | { type: "search/error"; error: JsonError; beforeStream?: boolean }
  | { type: "search/cancelled" }
  | { type: "search/reset" };

export const initialSearchState: SearchState = {
  status: "idle",
  hits: [],
  meta: null,
  done: null,
  error: null,
  errorBeforeStream: false,
  progress: null,
  searchCount: 0,
};

export function searchReducer(
  state: SearchState,
  action: SearchAction,
): SearchState {
  switch (action.type) {
    case "search/start":
      return {
        ...state,
        status: "running",
        meta: null,
        done: null,
        error: null,
        errorBeforeStream: false,
        progress: null,
      };
    case "search/stream":
      return { ...state, hits: [] };
    case "search/meta":
      return {
        ...state,
        meta: action.meta,
        searchCount: action.meta.searchCount ?? state.searchCount,
      };
    case "search/progress":
      return { ...state, progress: action.progress };
    case "search/hit":
      return { ...state, hits: [...state.hits, action.hit] };
    case "search/done":
      return {
        ...state,
        status: action.done.cancelled ? "cancelled" : "done",
        done: action.done,
      };
    case "search/error":
      return {
        ...state,
        status: "error",
        error: action.error,
        errorBeforeStream: action.beforeStream === true,
      };
    case "search/cancelled":
      return { ...state, status: "cancelled" };
    case "search/reset":
      return { ...initialSearchState, searchCount: state.searchCount };
  }
}
