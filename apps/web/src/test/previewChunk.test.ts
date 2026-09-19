import { LIMITS } from "@web-grep/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasLivePreviewLimits,
  livePreviewChunk,
  PREVIEW_CHUNK,
  resolvePreviewChunk,
  setLivePreviewLimits,
  subscribeLivePreviewLimits,
} from "../previewChunk.ts";

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

describe("live preview limits", () => {
  afterEach(() => {
    setLivePreviewLimits(undefined);
  });

  it("follows setLivePreviewLimits and ignores previewLines", () => {
    expect(hasLivePreviewLimits()).toBe(false);
    expect(livePreviewChunk()).toBe(LIMITS.previewChunk);
    setLivePreviewLimits({ previewChunk: 80, previewLines: 201 });
    expect(hasLivePreviewLimits()).toBe(true);
    expect(livePreviewChunk()).toBe(80);
    setLivePreviewLimits({ previewChunk: 500, previewChunkMax: 90 });
    expect(livePreviewChunk()).toBe(90);
  });

  it("notifies subscribers when live limits change", () => {
    const seen: number[] = [];
    const stop = subscribeLivePreviewLimits(() => {
      seen.push(livePreviewChunk());
    });
    setLivePreviewLimits({ previewChunk: 80 });
    expect(seen).toEqual([80]);
    stop();
    setLivePreviewLimits({ previewChunk: 40 });
    expect(seen).toEqual([80]);
  });
});
