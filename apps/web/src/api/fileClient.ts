import {
  type FileWindowResponse,
  FileWindowResponseSchema,
} from "@web-grep/shared";
import { apiHeaders } from "./headers.ts";
import { readJsonError, SearchHttpError } from "./searchClient.ts";

export const PREVIEW_CHUNK = 160;

export async function fetchFileWindow(
  query: {
    path: string;
    from?: number;
    count?: number;
    tail?: boolean;
    line?: number;
  },
  signal?: AbortSignal,
): Promise<FileWindowResponse> {
  const params = new URLSearchParams();
  params.set("path", query.path);
  if (query.tail === true) {
    params.set("tail", "1");
  } else if (query.from !== undefined) {
    params.set("from", String(query.from));
  } else if (query.line !== undefined) {
    params.set("line", String(query.line));
  }
  params.set("count", String(query.count ?? PREVIEW_CHUNK));
  const res = await fetch(`/api/file?${params.toString()}`, {
    headers: apiHeaders(),
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    throw await readJsonError(res);
  }
  const parsed = FileWindowResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "invalid file response",
    });
  }
  return parsed.data;
}
