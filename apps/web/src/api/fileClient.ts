import {
  type FileWindowResponse,
  FileWindowResponseSchema,
} from "@web-grep/shared";
import { fetchJson, SearchHttpError } from "./http.ts";

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
  const parsed = FileWindowResponseSchema.safeParse(
    await fetchJson(`/api/file?${params.toString()}`, { signal }),
  );
  if (!parsed.success) {
    throw new SearchHttpError(500, {
      code: "INTERNAL",
      message: "invalid file response",
    });
  }
  return parsed.data;
}
