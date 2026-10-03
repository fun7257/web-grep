import { describe, expect, it } from "vitest";
import {
  clipLineEnd,
  clipLogLine,
  clipResultSnippet,
  clipResultSnippets,
  EXPAND_CAP,
  EXPAND_HEAD,
  EXPAND_HIT_LEAD,
  type ExpandPiece,
  expandLogLine,
  LOG_LINE_CHAR_BUDGET,
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

  it("does not split a surrogate in a snippet prefix", () => {
    const text = `${"x".repeat(9)}😀${"y".repeat(20)}`;
    const clip = clipResultSnippets(text, [], 10)[0]!;
    expect(text.slice(clip.start, clip.end)).toBe("x".repeat(9));
    expect(loneSurrogate(text.slice(clip.start, clip.end))).toBe(false);
  });

  it("pulls a window start back onto a surrogate pair", () => {
    const text = `😀${"x".repeat(149)}needle${"y".repeat(400)}`;
    const at = text.indexOf("needle");
    expect(at).toBe(151);
    const clip = clipResultSnippet(text, [{ start: at, end: at + 6 }]);
    const view = text.slice(clip.start, clip.end);
    expect(view.startsWith("😀")).toBe(true);
    expect(view).toContain("needle");
    expect(loneSurrogate(view)).toBe(false);
  });
});

describe("clipLogLine", () => {
  it("keeps a line within the list budget whole", () => {
    const text = `${"x".repeat(100)}needle`;
    const at = text.indexOf("needle");
    expect(clipLogLine(text, [{ start: at, end: at + 6 }])).toEqual([
      { start: 0, end: text.length },
    ]);
    const exact = "n".repeat(LOG_LINE_CHAR_BUDGET);
    expect(
      clipLogLine(exact, [{ start: exact.length - 1, end: exact.length }]),
    ).toEqual([{ start: 0, end: exact.length }]);
  });

  it("reuses the snippet window when the hit is past the prefix", () => {
    const text = `${"x".repeat(20000)}needle`;
    const spans = [{ start: 20000, end: 20006 }];
    expect(clipLogLine(text, spans)).toEqual(clipResultSnippets(text, spans));
    const clip = clipLogLine(text, spans)[0]!;
    expect(clip.start).toBe(20000 - RESULT_SNIPPET_PREFIX_MAX);
    expect(clip.end).toBe(text.length);
    expect(text.slice(clip.start, clip.end).endsWith("needle")).toBe(true);
    expect(clip.start).toBeGreaterThan(0);
  });

  it("keeps only a trailing cut when the hit is near the start", () => {
    const text = `${"q".repeat(40)}needle${"z".repeat(4000)}`;
    const at = 40;
    const clip = clipLogLine(text, [{ start: at, end: at + 6 }])[0]!;
    expect(clip.start).toBe(0);
    expect(clip.end).toBeLessThan(text.length);
    expect(text.slice(clip.start, clip.end)).toContain("needle");
  });

  it("cuts both sides when the hit is in the middle", () => {
    const at = 8000;
    const text = `${"a".repeat(at)}needle${"b".repeat(8000)}`;
    const clip = clipLogLine(text, [{ start: at, end: at + 6 }])[0]!;
    expect(clip.start).toBe(at - RESULT_SNIPPET_PREFIX_MAX);
    expect(clip.end).toBe(at + 6 + RESULT_SNIPPET_PREFIX_MAX);
    expect(text.slice(clip.start, clip.end)).toContain("needle");
  });

  it("keeps the first hit when later clusters are dropped", () => {
    let text = "x".repeat(3500 + 8 * 800 + 10);
    const spans: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < 8; i++) {
      const start = 3500 + i * 800;
      const word = `T${String(i).padStart(3, "0")}`;
      text = `${text.slice(0, start)}${word}${text.slice(start + word.length)}`;
      spans.push({ start, end: start + word.length });
    }
    const clips = clipLogLine(text, spans);
    expect(clips[0]!.start).toBeGreaterThan(0);
    expect(text.slice(clips[0]!.start, clips[0]!.end)).toContain("T000");
    expect(clips.length).toBeLessThanOrEqual(RESULT_SNIPPET_MAX_CLUSTERS);
  });

  it("falls back to the prefix cut when nothing matches", () => {
    const text = `head${"h".repeat(4000)}`;
    expect(clipLogLine(text, [])).toEqual([clipLineEnd(text)]);
    expect(clipLogLine(text, [{ start: 5, end: 5 }])).toEqual([
      clipLineEnd(text),
    ]);
  });

  it("does not split a surrogate around a late CJK hit", () => {
    const cjk = "前缀😀目标词后缀";
    expect(cjk.slice(4, 7)).toBe("目标词");
    const text = `${"x".repeat(4000)}${cjk}`;
    const at = 4000 + 4;
    const clip = clipLogLine(text, [{ start: at, end: at + 3 }])[0]!;
    const view = text.slice(clip.start, clip.end);
    expect(view.slice(at - clip.start, at - clip.start + 3)).toBe("目标词");
    expect(view).toContain("😀");
    expect(loneSurrogate(view)).toBe(false);
  });
});

function visibleCount(pieces: ExpandPiece[]): number {
  let total = 0;
  for (const piece of pieces) {
    if (piece.kind === "text") {
      total += piece.end - piece.start;
    }
  }
  return total;
}

function covered(pieces: ExpandPiece[], index: number): boolean {
  return pieces.some(
    (piece) =>
      piece.kind === "text" && piece.start <= index && index < piece.end,
  );
}

function joined(text: string, pieces: ExpandPiece[]): string {
  let out = "";
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.kind === "skip") {
      expect(piece.omitted).toBeGreaterThan(0);
      cursor += piece.omitted;
      continue;
    }
    expect(piece.start).toBe(cursor);
    out += text.slice(piece.start, piece.end);
    cursor = piece.end;
  }
  expect(cursor).toBe(text.length);
  return out;
}

describe("expandLogLine", () => {
  it("shows a line within the cap whole", () => {
    const text = `hello ${"x".repeat(20)}`;
    expect(expandLogLine(text, [{ start: 6, end: 8 }])).toEqual([
      { kind: "text", start: 0, end: text.length },
    ]);
    const exact = "n".repeat(EXPAND_CAP);
    expect(expandLogLine(exact, [])).toEqual([
      { kind: "text", start: 0, end: EXPAND_CAP },
    ]);
    expect(expandLogLine("", [{ start: 0, end: 1 }])).toEqual([]);
  });

  it("keeps a prefix and the tail skip when there is no hit", () => {
    const text = "a".repeat(EXPAND_CAP + 40);
    const pieces = expandLogLine(text, []);
    expect(pieces).toEqual([
      { kind: "text", start: 0, end: EXPAND_CAP },
      { kind: "skip", omitted: 40 },
    ]);
    expect(visibleCount(pieces)).toBeLessThanOrEqual(EXPAND_CAP);
  });

  it("shows the whole prefix window when the first hit is inside the head", () => {
    const at = 80;
    const text = `${"甲".repeat(at)}目标${"乙".repeat(EXPAND_CAP)}`;
    const pieces = expandLogLine(text, [{ start: at, end: at + 2 }]);
    expect(covered(pieces, at)).toBe(true);
    expect(pieces[0]).toEqual({ kind: "text", start: 0, end: EXPAND_CAP });
    expect(pieces.filter((piece) => piece.kind === "skip")).toEqual([
      { kind: "skip", omitted: text.length - EXPAND_CAP },
    ]);
    expect(joined(text, pieces).slice(at, at + 2)).toBe("目标");
    expect(visibleCount(pieces)).toBeLessThanOrEqual(EXPAND_CAP);
  });

  it("keeps a far hit in the match window and counts both gaps", () => {
    const at = 2000;
    const text = `${"x".repeat(at)}NEEDLE${"y".repeat(2000)}`;
    const pieces = expandLogLine(text, [{ start: at, end: at + 6 }]);
    const ws = Math.max(EXPAND_HEAD, at - EXPAND_HIT_LEAD);
    const we = Math.min(text.length, ws + (EXPAND_CAP - EXPAND_HEAD));
    expect(pieces).toEqual([
      { kind: "text", start: 0, end: EXPAND_HEAD },
      { kind: "skip", omitted: ws - EXPAND_HEAD },
      { kind: "text", start: ws, end: we },
      { kind: "skip", omitted: text.length - we },
    ]);
    expect(covered(pieces, at)).toBe(true);
    expect(joined(text, pieces)).toContain("NEEDLE");
    expect(visibleCount(pieces)).toBe(EXPAND_CAP);
  });

  it("keeps a hit at the end of the line inside the window", () => {
    const tail = "NEEDLE";
    const text = `${"q".repeat(4900)}${tail}`;
    const at = text.length - tail.length;
    const pieces = expandLogLine(text, [{ start: at, end: text.length }]);
    const ws = Math.max(EXPAND_HEAD, at - EXPAND_HIT_LEAD);
    expect(pieces).toEqual([
      { kind: "text", start: 0, end: EXPAND_HEAD },
      { kind: "skip", omitted: ws - EXPAND_HEAD },
      { kind: "text", start: ws, end: text.length },
    ]);
    expect(text.slice(ws)).toContain("NEEDLE");
    expect(visibleCount(pieces)).toBeLessThanOrEqual(EXPAND_CAP);
    expect(joined(text, pieces).endsWith("NEEDLE")).toBe(true);
  });

  it("windows the first hit when later hits are farther along", () => {
    const first = 1800;
    const second = 4200;
    const text = `${"a".repeat(first)}ONE${"b".repeat(second - first - 3)}TWO${"c".repeat(400)}`;
    const pieces = expandLogLine(text, [
      { start: second, end: second + 3 },
      { start: first, end: first + 3 },
    ]);
    expect(covered(pieces, first)).toBe(true);
    expect(joined(text, pieces)).toContain("ONE");
    const ws = Math.max(EXPAND_HEAD, first - EXPAND_HIT_LEAD);
    expect(
      pieces.some((piece) => piece.kind === "text" && piece.start === ws),
    ).toBe(true);
    expect(visibleCount(pieces)).toBeLessThanOrEqual(EXPAND_CAP);
  });

  it("does not split a surrogate on the head or cap boundary", () => {
    const emoji = "😀";
    const headSplit = `${"a".repeat(EXPAND_HEAD - 1)}${emoji}${"b".repeat(400)}NEEDLE${"c".repeat(EXPAND_CAP)}`;
    const at = headSplit.indexOf("NEEDLE");
    const headPieces = expandLogLine(headSplit, [{ start: at, end: at + 6 }]);
    const headView = joined(headSplit, headPieces);
    expect(loneSurrogate(headView)).toBe(false);
    expect(headView).toContain("NEEDLE");
    expect(covered(headPieces, at)).toBe(true);

    const capSplit = `${"a".repeat(EXPAND_CAP - 1)}${emoji}${"b".repeat(80)}`;
    const capPieces = expandLogLine(capSplit, []);
    const capView = joined(capSplit, capPieces);
    expect(loneSurrogate(capView)).toBe(false);
    expect(capView.includes("😀") || !capView.includes("\uD83D")).toBe(true);
    expect(visibleCount(capPieces)).toBeLessThanOrEqual(EXPAND_CAP);
  });

  it("pulls a window start back onto a surrogate pair", () => {
    const emoji = "😀";
    const pad = EXPAND_HEAD + EXPAND_HIT_LEAD;
    const text = `${"a".repeat(pad - 1)}${emoji}${"b".repeat(40)}NEEDLE${"c".repeat(EXPAND_CAP)}`;
    const at = text.indexOf("NEEDLE");
    expect(at - EXPAND_HIT_LEAD).toBeGreaterThan(EXPAND_HEAD);
    const pieces = expandLogLine(text, [{ start: at, end: at + 6 }]);
    const view = joined(text, pieces);
    expect(loneSurrogate(view)).toBe(false);
    expect(view).toContain("😀");
    expect(view).toContain("NEEDLE");
    expect(covered(pieces, at)).toBe(true);
    expect(visibleCount(pieces)).toBeLessThanOrEqual(EXPAND_CAP);
  });

  it("ignores empty spans and spans that fall outside the line", () => {
    const text = `${"h".repeat(100)}NEEDLE${"t".repeat(EXPAND_CAP)}`;
    const pieces = expandLogLine(text, [
      { start: -20, end: -1 },
      { start: 4, end: 2 },
      { start: text.length + 10, end: text.length + 30 },
      { start: 8, end: 8 },
      { start: text.length - 3, end: text.length + 50 },
    ]);
    expect(covered(pieces, text.length - 3)).toBe(true);
    expect(joined(text, pieces).endsWith(text.slice(text.length - 3))).toBe(
      true,
    );
    const noHit = expandLogLine(text, [
      { start: -5, end: 0 },
      { start: text.length, end: text.length + 4 },
    ]);
    expect(noHit).toEqual(expandLogLine(text, []));
  });

  it("respects a caller cap and head", () => {
    const text = `${"p".repeat(50)}HIT${"q".repeat(200)}`;
    const pieces = expandLogLine(text, [{ start: 50, end: 53 }], 40, 10);
    expect(visibleCount(pieces)).toBeLessThanOrEqual(40);
    expect(covered(pieces, 50)).toBe(true);
    expect(joined(text, pieces)).toContain("H");
    expect(joined(text, pieces).startsWith("p")).toBe(true);
  });
});

function loneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
