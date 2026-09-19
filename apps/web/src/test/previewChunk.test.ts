import { LIMITS } from "@web-grep/shared";
import { describe, expect, it } from "vitest";
import { PREVIEW_CHUNK, resolvePreviewChunk } from "../previewChunk.ts";

describe("resolvePreviewChunk", () => {
  it("uses the shared default when meta has no chunk fields", () => {
    expect(PREVIEW_CHUNK).toBe(LIMITS.previewChunk);
    expect(resolvePreviewChunk()).toBe(LIMITS.previewChunk);
    expect(resolvePreviewChunk(null)).toBe(LIMITS.previewChunk);
    expect(resolvePreviewChunk({ previewLines: 201 })).toBe(
      LIMITS.previewChunk,
    );
  });

  it("prefers meta previewChunk and never treats previewLines as the request size", () => {
    expect(resolvePreviewChunk({ previewChunk: 80 })).toBe(80);
    expect(resolvePreviewChunk({ previewChunk: 80, previewLines: 201 })).toBe(
      80,
    );
  });

  it("clamps the request size to previewChunkMax when present", () => {
    expect(
      resolvePreviewChunk({ previewChunk: 500, previewChunkMax: 200 }),
    ).toBe(200);
    expect(resolvePreviewChunk({ previewChunkMax: 100 })).toBe(100);
  });

  it("ignores invalid meta numbers and falls back to shared limits", () => {
    expect(resolvePreviewChunk({ previewChunk: 0 })).toBe(LIMITS.previewChunk);
    expect(resolvePreviewChunk({ previewChunk: -3 })).toBe(LIMITS.previewChunk);
    expect(resolvePreviewChunk({ previewChunkMax: 0 })).toBe(
      LIMITS.previewChunk,
    );
  });
});
