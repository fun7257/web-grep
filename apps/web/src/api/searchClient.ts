import {
  type SearchRequestInput,
  SearchRequestSchema,
  type SseEvent,
} from "@web-grep/shared";
import { fetchApi, readJsonError, SearchHttpError } from "./http.ts";
import { readSse } from "./readSse.ts";

export { readJsonError, SearchHttpError } from "./http.ts";

export async function* streamSearch(
  input: SearchRequestInput,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const parsed = SearchRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new SearchHttpError(400, {
      code: "INVALID_QUERY",
      message: "invalid query",
    });
  }
  const res = await fetchApi("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
    signal,
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  if (!res.body) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "empty body",
    });
  }
  yield* readSse(res.body, signal);
}
