import { describe, expect, it } from "vitest";
import {
  clipLineEnd,
  LOG_LINE_CHAR_BUDGET,
  clipResultSnippet,
  clipResultSnippets,
  RESULT_SNIPPET_BUDGET,
  RESULT_SNIPPET_LINE_CHARS,
  RESULT_SNIPPET_MAX_BUDGET,
  RESULT_SNIPPET_MAX_CLUSTERS,
  RESULT_SNIPPET_MIN_BUDGET,
  RESULT_SNIPPET_PREFIX_MAX,
} from "../resultSnippet.ts";

describe("clipLineEnd", () => {
  it("keeps the prefix and cuts the tail", () => {
    const text = `hello${"x".repeat(2000)}`;
    const clip = clipLineEnd(text, 40);
    expect(clip).toEqual({ start: 0, end: 40 });
    expect(text.slice(clip.start, clip.end)).toBe("hello" + "x".repeat(35));
  });

  it("defaults to a half-pane budget, not a 10-line snippet", () => {
    expect(LOG_LINE_CHAR_BUDGET).toBe(3000);
    const text = "x".repeat(4000);
    expect(clipLineEnd(text).end).toBe(3000);
  });

  it("does not split a trailing surrogate pair", () => {
    const emoji = "😀";
    const text = "x".repeat(9) + emoji;
    const clip = clipLineEnd(text, 10);
    expect(text.slice(clip.start, clip.end)).toBe("x".repeat(9));
  });
});

describe("clipResultSnippet", () => {
  it("keeps a short line whole", () => {
    expect(clipResultSnippet("hello world", [{ start: 0, end: 5 }])).toEqual({
      start: 0,
      end: 11,
    });
  });

  it("centers a long line on the match instead of the prefix", () => {
    const prefix = "x".repeat(200);
    const text = `${prefix}NEEDLE${"y".repeat(80)}`;
    const at = prefix.length;
    const clip = clipResultSnippet(text, [{ start: at, end: at + 6 }], 40);
    const view = text.slice(clip.start, clip.end);
    expect(view).toContain("NEEDLE");
    expect(view.startsWith("x".repeat(40))).toBe(false);
    expect(clip.start).toBeGreaterThan(0);
  });

  it("skips leading indent so the match is not crowded out", () => {
    const text = `${" ".repeat(80)}foo = needle_value;`;
    const at = text.indexOf("needle");
    const clip = clipResultSnippet(text, [{ start: at, end: at + 6 }], 40);
    const view = text.slice(clip.start, clip.end);
    expect(view).toContain("needle");
    expect(view.startsWith("   ")).toBe(false);
  });

  it("keeps nearby AND matches in one window", () => {
    const text = `${"a".repeat(90)}hello world${"b".repeat(90)}`;
    const hello = text.indexOf("hello");
    const clip = clipResultSnippet(
      text,
      [
        { start: hello, end: hello + 5 },
        { start: hello + 6, end: hello + 11 },
      ],
      40,
    );
    const view = text.slice(clip.start, clip.end);
    expect(view).toContain("hello");
    expect(view).toContain("world");
  });

  it("splits far-apart AND matches into separate windows", () => {
    const text = `hello${"x".repeat(200)}world`;
    const clips = clipResultSnippets(
      text,
      [
        { start: 0, end: 5 },
        { start: text.length - 5, end: text.length },
      ],
      80,
    );
    expect(clips.length).toBe(2);
    expect(text.slice(clips[0]!.start, clips[0]!.end)).toContain("hello");
    expect(text.slice(clips[1]!.start, clips[1]!.end)).toContain("world");
  });

  it("uses the prefix when there is no match", () => {
    const text = "a".repeat(200);
    expect(clipResultSnippet(text, [], 40)).toEqual({ start: 0, end: 40 });
  });

  it("fits two context lines on each side", () => {
    expect(RESULT_SNIPPET_LINE_CHARS).toBe(75);
    expect(RESULT_SNIPPET_PREFIX_MAX).toBe(150);
    expect(RESULT_SNIPPET_BUDGET).toBe(375);
    expect(RESULT_SNIPPET_MIN_BUDGET).toBe(375);
    expect(RESULT_SNIPPET_MAX_BUDGET).toBe(750);
  });

  it("keeps two lines before the match and two after", () => {
    const text = `${"L".repeat(400)}NEEDLE${"R".repeat(400)}`;
    const at = 400;
    const clip = clipResultSnippet(text, [{ start: at, end: at + 6 }]);
    expect(at - clip.start).toBe(RESULT_SNIPPET_PREFIX_MAX);
    expect(clip.end - (at + 6)).toBe(RESULT_SNIPPET_PREFIX_MAX);
    expect(text.slice(clip.start, clip.end)).toContain("NEEDLE");
  });

  it("keeps same-line AND hits in one snippet when they fit", () => {
    const text = `route:/a ${"n".repeat(30)} 河北省 ${"m".repeat(30)} 42831 end`;
    const hebei = text.indexOf("河北省");
    const acc = text.indexOf("42831");
    const clips = clipResultSnippets(text, [
      { start: 6, end: 8 },
      { start: hebei, end: hebei + 3 },
      { start: acc, end: acc + 5 },
    ]);
    expect(clips).toHaveLength(1);
    const view = text.slice(clips[0]!.start, clips[0]!.end);
    expect(view).toContain("/a");
    expect(view).toContain("河北省");
    expect(view).toContain("42831");
  });

  it("caps extra highlight clusters instead of showing the whole line", () => {
    const spans = Array.from({ length: 8 }, (_, index) => ({
      start: index * 400,
      end: index * 400 + 5,
    }));
    const text = "x".repeat(8 * 400);
    const clips = clipResultSnippets(text, spans);
    expect(clips.length).toBeLessThanOrEqual(RESULT_SNIPPET_MAX_CLUSTERS);
    expect(clips.length).toBeGreaterThan(1);
  });

  it("still centers when the line is shorter than the budget", () => {
    const text = `${"L".repeat(200)}NEEDLE${"R".repeat(80)}`;
    const at = 200;
    const clip = clipResultSnippet(text, [{ start: at, end: at + 6 }]);
    expect(clip.start).toBeGreaterThan(0);
    expect(at - clip.start).toBe(RESULT_SNIPPET_PREFIX_MAX);
    expect(clip.end).toBe(text.length);
  });
});
