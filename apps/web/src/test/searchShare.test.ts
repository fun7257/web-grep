import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  captureShareState,
  parseShareSearch,
} from "../searchShare.ts";

describe("parseShareSearch", () => {
  it("returns null without a query", () => {
    expect(parseShareSearch("")).toBeNull();
    expect(parseShareSearch("p=src/a.ts")).toBeNull();
  });

  it("reads stacked terms and a hit location", () => {
    expect(
      parseShareSearch("?q=hello&q=world&p=src/a.ts&n=12&s=1&t=7d"),
    ).toEqual({
      parts: ["hello", "world"],
      mods: [
        { caseSensitive: true, wordMatch: false, regex: false },
        { caseSensitive: true, wordMatch: false, regex: false },
      ],
      caseSensitive: true,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 12,
      timeRange: "7d",
    });
  });

  it("reads the full file path, modifiers, and exclude globs", () => {
    expect(
      parseShareSearch(
        "?q=hello&p=apps/web/src/App.tsx&n=3&s=1&w=1&r=1&x=*.test.ts",
      ),
    ).toEqual({
      parts: ["hello"],
      mods: [{ caseSensitive: true, wordMatch: true, regex: true }],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 3,
      excludeGlobs: "*.test.ts",
    });
  });
});

describe("buildShareUrl", () => {
  it("writes a round-trippable link", () => {
    const href = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 1,
    });
    expect(href).toBe("http://127.0.0.1:5173/?q=hello&p=src%2Fa.ts&n=1");
    expect(parseShareSearch(new URL(href).search)).toEqual({
      parts: ["hello"],
      mods: [{ caseSensitive: false, wordMatch: false, regex: false }],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 1,
    });
  });

  it("captures live UI picks and exclude globs, not a previous search", () => {
    const state = captureShareState({
      fields: [
        {
          value: "hello",
          caseSensitive: true,
          wordMatch: true,
          regex: true,
        },
      ],
      fallbackParts: [
        {
          value: "stale",
          caseSensitive: false,
          wordMatch: false,
          regex: false,
        },
      ],
      excludeGlobs: "*.test.ts",
      picks: [
        { path: "ok.txt", dir: false },
        { path: "src", dir: true },
      ],
      timeRange: "7d",
      hitPath: "src/a.ts",
      hitLine: 4,
    });
    expect(state).toEqual({
      parts: ["hello"],
      mods: [{ caseSensitive: true, wordMatch: true, regex: true }],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      excludeGlobs: "*.test.ts",
      picks: [
        { path: "ok.txt", dir: false },
        { path: "src", dir: true },
      ],
      timeRange: "7d",
      path: "src/a.ts",
      line: 4,
    });
    const href = buildShareUrl("http://127.0.0.1:5173/", state!);
    const parsed = new URL(href);
    expect(parsed.searchParams.getAll("f")).toEqual(["ok.txt"]);
    expect(parsed.searchParams.getAll("d")).toEqual(["src"]);
    expect(parsed.searchParams.get("i")).toBeNull();
    expect(parsed.searchParams.get("k")).toBeNull();
    expect(parsed.searchParams.get("x")).toBe("*.test.ts");
    expect(parsed.searchParams.get("s")).toBe("1");
    expect(parseShareSearch(parsed.search)).toEqual(state);
  });

  it("round-trips the full file, modifiers, and exclude globs", () => {
    const href = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 9,
      excludeGlobs: "*.test.ts",
    });
    const parsed = new URL(href);
    expect(parsed.searchParams.get("p")).toBe("apps/web/src/App.tsx");
    expect(parsed.searchParams.get("s")).toBe("1");
    expect(parsed.searchParams.get("w")).toBe("1");
    expect(parsed.searchParams.get("r")).toBe("1");
    expect(parsed.searchParams.get("i")).toBeNull();
    expect(parsed.searchParams.get("x")).toBe("*.test.ts");
    expect(parseShareSearch(parsed.search)).toEqual({
      parts: ["hello"],
      mods: [{ caseSensitive: true, wordMatch: true, regex: true }],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 9,
      excludeGlobs: "*.test.ts",
    });
  });

  it("round-trips AND terms, folder picks, and every time gear", () => {
    for (const timeRange of ["today", "24h", "7d"] as const) {
      const href = buildShareUrl("http://127.0.0.1:5173/", {
        parts: ["hello", "world"],
        caseSensitive: false,
        wordMatch: false,
        regex: false,
        path: "logs/a.log",
        line: 8,
        timeRange,
        picks: [{ path: "logs", dir: true }],
      });
      const parsed = parseShareSearch(new URL(href).search);
      expect(parsed?.parts).toEqual(["hello", "world"]);
      expect(parsed?.picks).toEqual([{ path: "logs", dir: true }]);
      expect(parsed?.timeRange).toBe(timeRange);
      expect(parsed?.path).toBe("logs/a.log");
    }
    const picked = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      picks: [{ path: "skip.txt", dir: false }],
    });
    const parsedPicks = parseShareSearch(new URL(picked).search);
    expect(parsedPicks?.picks).toEqual([{ path: "skip.txt", dir: false }]);
    expect(new URL(picked).searchParams.get("k")).toBeNull();
    const mixed = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["Hello", "world.*"],
      mods: [
        { caseSensitive: true, wordMatch: false, regex: false },
        { caseSensitive: false, wordMatch: false, regex: true },
      ],
      caseSensitive: true,
      wordMatch: false,
      regex: false,
    });
    expect(new URL(mixed).searchParams.getAll("m")).toEqual(["s", "r"]);
    expect(parseShareSearch(new URL(mixed).search)?.mods).toEqual([
      { caseSensitive: true, wordMatch: false, regex: false },
      { caseSensitive: false, wordMatch: false, regex: true },
    ]);
    const noTime = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    expect(new URL(noTime).searchParams.get("t")).toBeNull();
    expect(parseShareSearch(new URL(noTime).search)?.timeRange).toBeUndefined();
  });
});
