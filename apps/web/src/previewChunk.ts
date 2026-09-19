import { LIMITS } from "@web-grep/shared";

export type PreviewChunkLimits = {
  previewChunk?: number;
  previewChunkMax?: number;
  /** Legacy meta field; ignored for /api/file request size. */
  previewLines?: number;
};

/** Shared default /api/file count. Prefer resolvePreviewChunk(meta.limits). */
export const PREVIEW_CHUNK = LIMITS.previewChunk;

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

/**
 * Per-request preview size. Uses meta `previewChunk` / `previewChunkMax`
 * when present; otherwise shared LIMITS. Never reads legacy `previewLines`.
 */
export function resolvePreviewChunk(
  limits?: PreviewChunkLimits | null,
): number {
  const max = positiveInt(limits?.previewChunkMax, LIMITS.previewChunkMax);
  const chunk = positiveInt(limits?.previewChunk, LIMITS.previewChunk);
  return Math.min(chunk, max);
}
