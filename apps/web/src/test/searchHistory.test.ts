/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  loadSearchHistory,
  pushSearchHistory,
  SEARCH_HISTORY_KEY,
} from "../searchHistory.ts";

describe("searchHistory", () => {
  it("dedupes and keeps the latest first", () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    const once = pushSearchHistory([], {
      parts: ["hello"],
      timeRange: "today",
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    const twice = pushSearchHistory(once, {
      parts: ["world"],
      timeRange: "today",
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    const again = pushSearchHistory(twice, {
      parts: ["hello"],
      timeRange: "today",
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    expect(again.map((item) => item.parts[0])).toEqual(["hello", "world"]);
    expect(loadSearchHistory()).toHaveLength(2);
  });
});
