import { describe, expect, it } from "vitest";
import {
  ErrorCodeSchema,
  FileQuerySchema,
  LIMITS,
  SearchRequestSchema,
  SseMetaSchema,
} from "../src/index.ts";

describe("SearchRequestSchema", () => {
  it("rejects an empty query", () => {
    expect(SearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
  });

  it("rejects a 513-char query", () => {
    expect(
      SearchRequestSchema.safeParse({
        query: "a".repeat(LIMITS.queryMaxChars + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects maxResults above the hard cap", () => {
    expect(
      SearchRequestSchema.safeParse({ query: "foo", maxResults: 99_999 })
        .success,
    ).toBe(false);
  });

  it("applies defaults on z.output", () => {
    const parsed = SearchRequestSchema.parse({ query: "foo" });
    expect(parsed.query).toBe("foo");
    expect(parsed.path).toBe("");
    expect(parsed.globInclude).toEqual([]);
    expect(parsed.globExclude).toEqual([]);
    expect(parsed.regex).toBe(true);
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.wordMatch).toBe(false);
    expect(parsed.hidden).toBe(false);
    expect(parsed.maxResults).toBeUndefined();
  });
});

describe("SseMetaSchema", () => {
  it("accepts a UUID searchId", () => {
    const parsed = SseMetaSchema.parse({
      searchId: "550e8400-e29b-41d4-a716-446655440000",
      engine: "rg",
    });
    expect(parsed.searchId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects a ULID-like searchId", () => {
    expect(
      SseMetaSchema.safeParse({
        searchId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        engine: "rg",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid searchId", () => {
    expect(
      SseMetaSchema.safeParse({
        searchId: "not-a-uuid",
        engine: "literal",
      }).success,
    ).toBe(false);
  });
});

describe("FileQuerySchema", () => {
  it("defaults before/after to LIMITS.beforeAfterDefault", () => {
    const parsed = FileQuerySchema.parse({ path: "src/app.ts", line: 1 });
    expect(parsed.before).toBe(LIMITS.beforeAfterDefault);
    expect(parsed.after).toBe(LIMITS.beforeAfterDefault);
  });

  it("rejects before/after above LIMITS.beforeAfterMax", () => {
    expect(
      FileQuerySchema.safeParse({
        path: "src/app.ts",
        line: 1,
        before: LIMITS.beforeAfterMax + 1,
      }).success,
    ).toBe(false);
    expect(
      FileQuerySchema.safeParse({
        path: "src/app.ts",
        line: 1,
        after: LIMITS.beforeAfterMax + 1,
      }).success,
    ).toBe(false);
  });
});

describe("ErrorCodeSchema", () => {
  it("rejects TIMEOUT", () => {
    expect(ErrorCodeSchema.safeParse("TIMEOUT").success).toBe(false);
  });
});
