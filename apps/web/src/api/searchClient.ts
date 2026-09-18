import {
  type JsonError,
  JsonErrorSchema,
  type SearchRequestInput,
  SearchRequestSchema,
  type SseEvent,
} from "@web-grep/shared";
import { apiUrl } from "./base.ts";
import { apiHeaders } from "./headers.ts";
import { readSse } from "./readSse.ts";

export class SearchHttpError extends Error {
  readonly status: number;
  readonly body: JsonError;

  constructor(status: number, body: JsonError) {
    super("search request failed");
    this.name = "SearchHttpError";
    this.status = status;
    this.body = body;
  }
}

export async function readJsonError(res: Response): Promise<SearchHttpError> {
  let body: JsonError | undefined;
  try {
    const json: unknown = await res.json();
    const parsed = JsonErrorSchema.safeParse(json);
    if (parsed.success) {
      body = parsed.data;
    }
  } catch {
    // non-JSON error body
  }
  if (body !== undefined) {
    return new SearchHttpError(res.status, body);
  }
  if (res.status === 401) {
    return new SearchHttpError(res.status, {
      code: "UNAUTHORIZED",
      message: "missing or invalid token",
    });
  }
  return new SearchHttpError(res.status, {
    code: "INTERNAL",
    message: "request failed",
  });
}

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
  const res = await fetch(apiUrl("/api/search"), {
    method: "POST",
    headers: { "content-type": "application/json", ...apiHeaders() },
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
