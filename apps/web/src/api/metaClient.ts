import { MetaResponseSchema, type MetaResponse } from "@web-grep/shared";
import { fetchApi, readJsonError, type SearchHttpError } from "./http.ts";

export type MetaLoadResult =
  | { ok: true; meta: MetaResponse }
  | { ok: false; status: number; error?: SearchHttpError };

export async function loadMetaResponse(
  signal?: AbortSignal,
): Promise<MetaLoadResult> {
  const res = await fetchApi("/api/meta", {
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: await readJsonError(res),
    };
  }
  const parsed = MetaResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    return { ok: false, status: res.status };
  }
  return { ok: true, meta: parsed.data };
}
