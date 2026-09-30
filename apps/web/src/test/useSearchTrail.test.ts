/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSearchTrail } from "../hooks/useSearchTrail.ts";
import { SEARCH_HISTORY_KEY } from "../searchHistory.ts";
import type { SearchNavEntry } from "../searchNav.ts";

function entry(value: string): SearchNavEntry {
  return {
    parts: [{ value, caseSensitive: false, wordMatch: false, regex: false }],
    timeRange: null,
  };
}

describe("useSearchTrail", () => {
  beforeEach(() => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  });

  it("starts with nothing to go back or forward to", () => {
    const { result } = renderHook(() => useSearchTrail());
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.history).toEqual([]);
    expect(result.current.step(-1)).toBeNull();
    expect(result.current.step(1)).toBeNull();
  });

  it("records searches and lists them newest first in history", () => {
    const { result } = renderHook(() => useSearchTrail());
    act(() => {
      result.current.record(entry("one"));
    });
    act(() => {
      result.current.record(entry("two"));
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.history.map((item) => item.parts[0]?.value)).toEqual([
      "two",
      "one",
    ]);
  });

  it("steps back and forward and returns the entry to replay", () => {
    const { result } = renderHook(() => useSearchTrail());
    act(() => {
      result.current.record(entry("one"));
    });
    act(() => {
      result.current.record(entry("two"));
    });
    let back: SearchNavEntry | null = null;
    act(() => {
      back = result.current.step(-1);
    });
    expect(back).toEqual(entry("one"));
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);
    let forward: SearchNavEntry | null = null;
    act(() => {
      forward = result.current.step(1);
    });
    expect(forward).toEqual(entry("two"));
    expect(result.current.canGoForward).toBe(false);
  });

  it("does not push the replayed search onto the nav stack again", () => {
    const { result } = renderHook(() => useSearchTrail());
    act(() => {
      result.current.record(entry("one"));
    });
    act(() => {
      result.current.record(entry("two"));
    });
    act(() => {
      result.current.step(-1);
    });
    // The replay may differ from the stored entry (e.g. trimmed parts), so
    // dedupe alone would not keep the forward stack; the skip flag must.
    act(() => {
      result.current.record(entry("one (replayed)"));
    });
    expect(result.current.canGoForward).toBe(true);
    expect(result.current.history[0]?.parts[0]?.value).toBe("one (replayed)");
  });

  it("drops the forward stack when a new search is recorded after stepping back", () => {
    const { result } = renderHook(() => useSearchTrail());
    act(() => {
      result.current.record(entry("one"));
    });
    act(() => {
      result.current.record(entry("two"));
    });
    act(() => {
      result.current.step(-1);
    });
    act(() => {
      result.current.record(entry("one"));
    });
    act(() => {
      result.current.record(entry("three"));
    });
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.canGoBack).toBe(true);
  });
});
