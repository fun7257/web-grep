/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { findAll, findTextRanges, wrapIndex } from "../previewFind.ts";

describe("findAll", () => {
  it("finds non-overlapping case-insensitive matches", () => {
    expect(
      findAll("account account", "Account", {
        caseSensitive: false,
        wordMatch: false,
      }),
    ).toEqual([
      { start: 0, end: 7 },
      { start: 8, end: 15 },
    ]);
  });

  it("returns nothing for an empty needle", () => {
    expect(
      findAll("hello", "", { caseSensitive: false, wordMatch: false }),
    ).toEqual([]);
  });

  it("respects case when asked", () => {
    expect(
      findAll("Account account", "Account", {
        caseSensitive: true,
        wordMatch: false,
      }),
    ).toEqual([{ start: 0, end: 7 }]);
  });

  it("restricts matches to whole words when asked", () => {
    expect(
      findAll("cat catalog cat.", "cat", {
        caseSensitive: false,
        wordMatch: true,
      }),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 12, end: 15 },
    ]);
  });
});

describe("wrapIndex", () => {
  it("wraps forward and backward", () => {
    expect(wrapIndex(2, 3, 1)).toBe(0);
    expect(wrapIndex(0, 3, -1)).toBe(2);
  });
});

describe("findTextRanges", () => {
  it("finds a query split across inline text nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>acc</span><span>ount</span>";
    const ranges = findTextRanges(root, "account", {
      caseSensitive: false,
      wordMatch: false,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe("account");
  });
});
