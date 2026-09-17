import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesUserGlob, parseGlobs } from "../globs.ts";

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
});

describe("matchesAnyGlob", () => {
  it("is true when any pattern matches", () => {
    expect(matchesAnyGlob("a.test.ts", ["*.log", "*.test.ts"])).toBe(true);
    expect(matchesAnyGlob("a.ts", ["*.log", "*.test.ts"])).toBe(false);
  });
});
