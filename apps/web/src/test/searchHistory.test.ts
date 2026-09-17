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
      parts: [
        {
          value: "hello",
          caseSensitive: false,
          wordMatch: false,
          regex: false,
        },
      ],
      timeRange: "today",
    });
    const twice = pushSearchHistory(once, {
      parts: [
        {
          value: "world",
          caseSensitive: false,
          wordMatch: false,
          regex: false,
        },
      ],
      timeRange: "today",
    });
    const again = pushSearchHistory(twice, {
      parts: [
        {
          value: "hello",
          caseSensitive: false,
          wordMatch: false,
          regex: false,
        },
      ],
      timeRange: "today",
    });
    expect(again.map((item) => item.parts[0]?.value)).toEqual(["hello", "world"]);
    expect(loadSearchHistory()).toHaveLength(2);
  });
});
