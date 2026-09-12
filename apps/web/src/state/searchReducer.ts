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
  progress: SseProgress | null;
};

export type SearchAction =
  | { type: "search/start" }
  | { type: "search/stream" }
  | { type: "search/meta"; meta: SseMeta }
  | { type: "search/progress"; progress: SseProgress }
  | { type: "search/hit"; hit: SseHit }
  | { type: "search/done"; done: SseDone }
  | { type: "search/error"; error: JsonError }
  | { type: "search/cancelled" }
  | { type: "search/reset" };

export const initialSearchState: SearchState = {
  status: "idle",
  hits: [],
  meta: null,
  done: null,
  error: null,
  progress: null,
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
        progress: null,
      };
    case "search/stream":
      return { ...state, hits: [] };
    case "search/meta":
      return { ...state, meta: action.meta };
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
      return { ...state, status: "error", error: action.error };
    case "search/cancelled":
      return { ...state, status: "cancelled" };
    case "search/reset":
      return initialSearchState;
  }
}
