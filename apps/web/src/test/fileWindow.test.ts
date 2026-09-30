import { describe, expect, it } from "vitest";
import {
  anchoredScrollTop,
  captureLineAnchor,
  mergeLines,
  rangeForLine,
  scrollTopAfterPrepend,
  scrollTopToHoldLine,
  upwardRange,
} from "../fileWindow.ts";

describe("rangeForLine", () => {
  it("keeps count at most maxCount and still includes the target", () => {
    expect(rangeForLine(1, 160)).toEqual({ from: 1, count: 160 });
    expect(rangeForLine(1000, 160)).toEqual({ from: 841, count: 160 });
    expect(rangeForLine(1000, 160, 400)).toEqual({ from: 840, count: 320 });
    expect(rangeForLine(50, 160)).toEqual({ from: 1, count: 160 });
    expect(rangeForLine(50, 160, 400)).toEqual({ from: 1, count: 209 });
    expect(rangeForLine(5, 3)).toEqual({ from: 3, count: 3 });
    const tight = rangeForLine(1000, 400, 160);
    expect(tight.count).toBe(160);
    expect(tight.from).toBe(841);
    expect(tight.from).toBeLessThanOrEqual(1000);
    expect(tight.from + tight.count - 1).toBeGreaterThanOrEqual(1000);
  });
});

describe("upwardRange", () => {
  it("requests the page above the loaded window and stops at line 1", () => {
    expect(upwardRange(29840, 160)).toEqual({ from: 29680, count: 160 });
    expect(upwardRange(50, 160)).toEqual({ from: 1, count: 49 });
    expect(upwardRange(1, 160)).toBeNull();
    expect(upwardRange(0, 160)).toBeNull();
    expect(upwardRange(2.5, 160)).toBeNull();
  });
});

describe("mergeLines", () => {
  it("unions by line number and sorts", () => {
    expect(
      mergeLines(
        [
          { n: 10, text: "a" },
          { n: 11, text: "b" },
        ],
        [
          { n: 9, text: "z" },
          { n: 11, text: "b2" },
        ],
      ),
    ).toEqual([
      { n: 9, text: "z" },
      { n: 10, text: "a" },
      { n: 11, text: "b2" },
    ]);
  });
});

describe("line anchor", () => {
  const lines = [
    { n: 29840, text: "a" },
    { n: 29841, text: "b" },
    { n: 29842, text: "c" },
  ];
  const items = [
    { index: 0, start: 0, end: 20 },
    { index: 1, start: 20, end: 40 },
    { index: 2, start: 40, end: 60 },
  ];

  it("anchors the first row that still intersects the viewport", () => {
    expect(captureLineAnchor(lines, items, 30)).toEqual({
      prevFirst: 29840,
      line: 29841,
      offset: 20 - 30,
    });
    expect(captureLineAnchor(lines, items, 0)).toEqual({
      prevFirst: 29840,
      line: 29840,
      offset: 0,
    });
    expect(captureLineAnchor([], items, 0)).toBeNull();
  });

  it("holds the anchor with its measured start, not the row estimate", () => {
    expect(scrollTopToHoldLine(4000, -10)).toBe(4010);
    expect(scrollTopToHoldLine(5, 10)).toBe(0);
    expect(scrollTopAfterPrepend(40, 160, 26)).toBe(40 + 160 * 26);
    expect(scrollTopAfterPrepend(40, 0, 26)).toBe(40);
    expect(
      anchoredScrollTop({
        prevFirst: 29840,
        nextFirst: 29680,
        anchorIndex: 162,
        anchorStart: 4000,
        anchorOffset: 10,
        prevScrollTop: 40,
        rowHeight: 26,
      }),
    ).toBe(3990);
    expect(
      anchoredScrollTop({
        prevFirst: 29840,
        nextFirst: 29680,
        anchorIndex: 162,
        anchorStart: 0,
        anchorOffset: 10,
        prevScrollTop: 40,
        rowHeight: 26,
      }),
    ).toBe(40 + 160 * 26);
  });
});
