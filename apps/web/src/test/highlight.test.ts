import { describe, expect, it } from "vitest";
import { highlightSpans, spansForQuery } from "../highlight.ts";

describe("spansForQuery", () => {
  it("colors each AND term separately", () => {
    const spans = spansForQuery("hello world", ["hello", "world"], {
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    expect(spans).toEqual([
      { start: 0, end: 5, tone: 0 },
      { start: 6, end: 11, tone: 1 },
    ]);
  });

  it("finds terms case-insensitively", () => {
    const spans = spansForQuery("Hello WORLD", ["hello", "world"], {
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    expect(spans.map((span) => span.tone)).toEqual([0, 1]);
  });

  it("prefers query terms over a single rg span", () => {
    const spans = highlightSpans(
      "hello world",
      ["hello", "world"],
      { caseSensitive: false, wordMatch: false, regex: false },
      [{ start: 0, end: 11 }],
    );
    expect(spans).toHaveLength(2);
    expect(spans[0]?.tone).toBe(0);
    expect(spans[1]?.tone).toBe(1);
  });

  it("honors per-term case sensitivity", () => {
    const spans = spansForQuery("Hello WORLD", [
      { value: "Hello", caseSensitive: true },
      { value: "world", caseSensitive: true },
    ]);
    expect(spans).toEqual([{ start: 0, end: 5, tone: 0 }]);
  });
});
