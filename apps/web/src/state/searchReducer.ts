import type { JsonError, SseDone, SseHit, SseMeta } from "@web-grep/shared";

export type SearchStatus = "idle" | "running" | "done" | "cancelled" | "error";

export type SearchState = {
  status: SearchStatus;
  hits: SseHit[];
  meta: SseMeta | null;
  done: SseDone | null;
  error: JsonError | null;
};

export type SearchAction =
  | { type: "search/start" }
  | { type: "search/meta"; meta: SseMeta }
  | { type: "search/hit"; hit: SseHit }
  | { type: "search/done"; done: SseDone }
  | { type: "search/error"; error: JsonError }
  | { type: "search/cancelled" };

export const initialSearchState: SearchState = {
  status: "idle",
  hits: [],
  meta: null,
  done: null,
  error: null,
};

export function searchReducer(
  state: SearchState,
  action: SearchAction,
): SearchState {
  switch (action.type) {
    case "search/start":
      return { ...initialSearchState, status: "running" };
    case "search/meta":
      return { ...state, meta: action.meta };
    case "search/hit":
      return { ...state, hits: [...state.hits, action.hit] };
    case "search/done":
      return {
        ...state,
        status: action.done.cancelled ? "cancelled" : "done",
        done: action.done,
      };
    case "search/error":
      // Keep already-rendered hits when the stream errors after hits.
      return { ...state, status: "error", error: action.error };
    case "search/cancelled":
      return { ...state, status: "cancelled" };
  }
}
