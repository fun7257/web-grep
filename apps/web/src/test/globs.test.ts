import { describe, expect, it } from "vitest";
import {
  escapeGlobPath,
  matchesAnyGlob,
  matchesUserGlob,
  parseGlobs,
} from "../globs.ts";

describe("parseGlobs", () => {
  it("splits on commas, semicolons, and spaces", () => {
    expect(parseGlobs("*.log, *.tmp; skip.ts")).toEqual([
      "*.log",
      "*.tmp",
      "skip.ts",
    ]);
  });
});

describe("matchesUserGlob", () => {
  it("treats unanchored wildcards as basename matches", () => {
    expect(matchesUserGlob("skip.log", "*.log")).toBe(true);
    expect(matchesUserGlob("dir/skip.log", "*.log")).toBe(true);
    expect(matchesUserGlob("skip.txt", "*.log")).toBe(false);
  });

  it("treats literals as exact paths", () => {
    expect(matchesUserGlob("ok.txt", "ok.txt")).toBe(true);
    expect(matchesUserGlob("dir/ok.txt", "ok.txt")).toBe(false);
  });

  it("matches recursive folder globs", () => {
    expect(matchesUserGlob("logs/a.log", "logs/**")).toBe(true);
    expect(matchesUserGlob("src/a.log", "logs/**")).toBe(false);
  });

  it("treats escaped brackets and braces as literals", () => {
    const pattern = escapeGlobPath("app/[id]");
    expect(pattern).toBe("app/\\[id\\]");
    expect(matchesUserGlob("app/[id]/page.tsx", `${pattern}/**`)).toBe(true);
    expect(matchesUserGlob("app/other/page.tsx", `${pattern}/**`)).toBe(false);
    expect(matchesUserGlob("a/{id}/page.tsx", `${escapeGlobPath("a/{id}")}/**`)).toBe(
      true,
    );
  });
});

describe("matchesAnyGlob", () => {
  it("is true when any pattern matches", () => {
    expect(matchesAnyGlob("a.test.ts", ["*.log", "*.test.ts"])).toBe(true);
    expect(matchesAnyGlob("a.ts", ["*.log", "*.test.ts"])).toBe(false);
  });
});
