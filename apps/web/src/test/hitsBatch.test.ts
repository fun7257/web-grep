/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { SseHit } from "@web-grep/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HIT_BATCH_MS,
  HIT_BATCH_N,
  shouldFlushListHits,
  useBatchedHits,
} from "../hooks/useBatchedHits.ts";
import type { SearchStatus } from "../state/searchReducer.ts";

function hit(path: string, line: number): SseHit {
  return {
    path,
    line,
    text: `${path}:${line}`,
    matches: [{ start: 0, end: 1 }],
  };
}

function hitsOf(n: number): SseHit[] {
  const out: SseHit[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(hit("src/a.ts", i));
  }
  return out;
}

describe("shouldFlushListHits", () => {
  it("flushes on done, error, cancel, and idle", () => {
    const published = hitsOf(1);
    const incoming = hitsOf(3);
    for (const status of ["done", "error", "cancelled", "idle"] as const) {
      expect(shouldFlushListHits(published, incoming, status)).toBe(true);
    }
  });

  it("flushes an empty incoming list and a stale previous search", () => {
    expect(shouldFlushListHits(hitsOf(2), [], "running")).toBe(true);
    expect(shouldFlushListHits(hitsOf(2), hitsOf(1), "running")).toBe(true);
  });

  it("flushes the first paint and a burst of N hits", () => {
    const first = hitsOf(1);
    expect(shouldFlushListHits([], first, "running")).toBe(true);
    const published = hitsOf(1);
    const burst = [...published, ...hitsOf(HIT_BATCH_N)];
    expect(shouldFlushListHits(published, burst, "running")).toBe(true);
  });

  it("holds a small running increment for the batch window", () => {
    const published = hitsOf(1);
    const incoming = [...published, hit("src/a.ts", 2)];
    expect(shouldFlushListHits(published, incoming, "running")).toBe(false);
  });
});

describe("useBatchedHits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the first hits immediately, then batches until the window or done", () => {
    const h1 = hit("src/a.ts", 1);
    const h2 = hit("src/b.ts", 2);
    const h3 = hit("src/c.ts", 3);

    const { result, rerender } = renderHook(
      (props: { hits: SseHit[]; status: SearchStatus }) =>
        useBatchedHits(props.hits, props.status),
      {
        initialProps: {
          hits: [] as SseHit[],
          status: "running" as SearchStatus,
        },
      },
    );

    rerender({ hits: [h1], status: "running" });
    expect(result.current).toEqual([h1]);

    rerender({ hits: [h1, h2], status: "running" });
    expect(result.current).toEqual([h1]);

    act(() => {
      vi.advanceTimersByTime(HIT_BATCH_MS - 1);
    });
    expect(result.current).toEqual([h1]);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual([h1, h2]);

    rerender({ hits: [h1, h2, h3], status: "running" });
    expect(result.current).toEqual([h1, h2]);

    rerender({ hits: [h1, h2, h3], status: "done" });
    expect(result.current).toEqual([h1, h2, h3]);
  });

  it("flushes immediately on error and cancel", () => {
    const h1 = hit("src/a.ts", 1);
    const h2 = hit("src/b.ts", 2);

    const { result, rerender } = renderHook(
      (props: { hits: SseHit[]; status: SearchStatus }) =>
        useBatchedHits(props.hits, props.status),
      { initialProps: { hits: [h1], status: "running" as SearchStatus } },
    );

    rerender({ hits: [h1, h2], status: "running" });
    expect(result.current).toEqual([h1]);

    rerender({ hits: [h1, h2], status: "error" });
    expect(result.current).toEqual([h1, h2]);

    rerender({ hits: [h1], status: "running" });
    rerender({ hits: [h1, h2], status: "running" });
    expect(result.current).toEqual([h1]);
    rerender({ hits: [h1, h2], status: "cancelled" });
    expect(result.current).toEqual([h1, h2]);
  });
});
