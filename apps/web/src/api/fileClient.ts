import {
  type FileWindowResponse,
  FileWindowResponseSchema,
} from "@web-grep/shared";
import { apiHeaders } from "./headers.ts";
import { readJsonError, SearchHttpError } from "./searchClient.ts";

export async function fetchFileWindow(
  query: { path: string; line: number },
  signal: AbortSignal,
): Promise<FileWindowResponse> {
  const params = new URLSearchParams();
  params.set("path", query.path);
  params.set("line", String(query.line));
  const res = await fetch(`/api/file?${params.toString()}`, {
    headers: apiHeaders(),
    signal,
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
