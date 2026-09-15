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
      caseSensitive: true,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 12,
      timeRange: "7d",
    });
  });

  it("reads the full file path and advanced options", () => {
    expect(
      parseShareSearch(
        "?q=hello&p=apps/web/src/App.tsx&n=3&s=1&w=1&r=1&i=*.ts&x=*.test.ts",
      ),
    ).toEqual({
      parts: ["hello"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 3,
      includeGlobs: "*.ts",
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
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 1,
    });
  });

  it("captures live UI picks and advanced options, not a previous search", () => {
    const state = captureShareState({
      fields: ["hello"],
      fallbackParts: ["stale"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      includeGlobs: "*.ts",
      excludeGlobs: "*.test.ts",
      picks: [
        { path: "ok.txt", dir: false },
        { path: "src", dir: true },
      ],
      scope: "include",
      timeRange: "7d",
      hitPath: "src/a.ts",
      hitLine: 4,
    });
    expect(state).toEqual({
      parts: ["hello"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      includeGlobs: "*.ts",
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
    expect(parsed.searchParams.get("i")).toBe("*.ts");
    expect(parsed.searchParams.get("x")).toBe("*.test.ts");
    expect(parsed.searchParams.get("s")).toBe("1");
    expect(parseShareSearch(parsed.search)).toEqual(state);
  });

  it("round-trips the full file and advanced options", () => {
    const href = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 9,
      includeGlobs: "*.ts, src/**",
      excludeGlobs: "*.test.ts",
    });
    const parsed = new URL(href);
    expect(parsed.searchParams.get("p")).toBe("apps/web/src/App.tsx");
    expect(parsed.searchParams.get("s")).toBe("1");
    expect(parsed.searchParams.get("w")).toBe("1");
    expect(parsed.searchParams.get("r")).toBe("1");
    expect(parsed.searchParams.get("i")).toBe("*.ts, src/**");
    expect(parsed.searchParams.get("x")).toBe("*.test.ts");
    expect(parseShareSearch(parsed.search)).toEqual({
      parts: ["hello"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      path: "apps/web/src/App.tsx",
      line: 9,
      includeGlobs: "*.ts, src/**",
      excludeGlobs: "*.test.ts",
    });
  });

  it("round-trips AND terms, folder picks, exclude scope, and every time gear", () => {
    for (const timeRange of ["1h", "today", "24h", "7d", "30d"] as const) {
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
    const excluded = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      picks: [{ path: "skip.txt", dir: false }],
      scope: "exclude",
    });
    const parsedEx = parseShareSearch(new URL(excluded).search);
    expect(parsedEx?.picks).toEqual([{ path: "skip.txt", dir: false }]);
    expect(parsedEx?.scope).toBe("exclude");
    expect(new URL(excluded).searchParams.get("k")).toBe("x");
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
