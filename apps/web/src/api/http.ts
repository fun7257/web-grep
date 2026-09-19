import { type JsonError, JsonErrorSchema } from "@web-grep/shared";
import { apiUrl } from "./base.ts";
import { apiHeaders } from "./headers.ts";

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

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
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

export type FetchApiInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal | undefined;
};

export function fetchApi(
  path: string,
  init: FetchApiInit = {},
): Promise<Response> {
  return fetch(apiUrl(path), {
    ...(init.method !== undefined ? { method: init.method } : {}),
    headers: { ...apiHeaders(), ...init.headers },
    ...(init.body !== undefined && init.body !== null
      ? { body: init.body }
      : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });
}

export async function fetchJson(
  path: string,
  init: FetchApiInit = {},
): Promise<unknown> {
  const res = await fetchApi(path, init);
  if (!res.ok) {
    throw await readJsonError(res);
  }
  return res.json();
}

export function abortableSleep(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort);
  });
}
