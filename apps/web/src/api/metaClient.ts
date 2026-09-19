import { MetaResponseSchema, type MetaResponse } from "@web-grep/shared";
import { setLivePreviewLimits } from "../previewChunk.ts";
import { fetchApi, readJsonError, type SearchHttpError } from "./http.ts";

export type MetaLoadResult =
  | { ok: true; meta: MetaResponse }
  | { ok: false; status: number; error?: SearchHttpError };

function attachPreviewChunk(meta: MetaResponse, raw: unknown): MetaResponse {
  if (raw === null || typeof raw !== "object" || !("limits" in raw)) {
    return meta;
  }
  const rawLimits = (raw as { limits?: unknown }).limits;
  if (rawLimits === null || typeof rawLimits !== "object") {
    return meta;
  }
  const chunk = (rawLimits as { previewChunk?: unknown }).previewChunk;
  const max = (rawLimits as { previewChunkMax?: unknown }).previewChunkMax;
  const limits = { ...meta.limits };
  if (typeof chunk === "number" && Number.isFinite(chunk)) {
    limits.previewChunk = chunk;
  }
  if (typeof max === "number" && Number.isFinite(max)) {
    limits.previewChunkMax = max;
  }
  return { ...meta, limits };
}

export async function loadMetaResponse(
  signal?: AbortSignal,
): Promise<MetaLoadResult> {
  const res = await fetchApi("/api/meta", { signal });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: await readJsonError(res),
    };
  }
  const raw: unknown = await res.json();
  const parsed = MetaResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: res.status };
  }
  const meta = attachPreviewChunk(parsed.data, raw);
  setLivePreviewLimits(meta.limits);
  return { ok: true, meta };
}
