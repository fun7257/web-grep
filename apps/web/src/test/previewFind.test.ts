/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  collectSearchText,
  findAll,
  findTextRanges,
  paintFindRanges,
  wrapIndex,
} from "../previewFind.ts";

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

  it("stays at zero when there are no matches", () => {
    expect(wrapIndex(0, 0, 1)).toBe(0);
    expect(wrapIndex(4, 0, -1)).toBe(0);
  });
});

describe("collectSearchText", () => {
  it("skips line numbers and the find bar chrome", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span class="preview-n">42</span><span class="preview-text">hello</span><div class="preview-find">Find foo</div>';
    const { flat } = collectSearchText(root);
    expect(flat).toBe("hello");
    expect(flat).not.toContain("42");
    expect(flat).not.toContain("Find");
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

  it("returns no ranges for an empty query", () => {
    const root = document.createElement("div");
    root.textContent = "hello";
    expect(
      findTextRanges(root, "", { caseSensitive: false, wordMatch: false }),
    ).toEqual([]);
  });
});

describe("paintFindRanges", () => {
  it("selects the current match when CSS highlights are unavailable", () => {
    const root = document.createElement("div");
    root.textContent = "hello hello";
    document.body.appendChild(root);
    const ranges = findTextRanges(root, "hello", {
      caseSensitive: false,
      wordMatch: false,
    });
    expect(ranges).toHaveLength(2);
    paintFindRanges(ranges, 1);
    expect(window.getSelection()?.toString()).toBe("hello");
    root.remove();
  });
});
