import { describe, expect, it } from "vitest";
import {
  AuthStatusSchema,
  ErrorCodeSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  FileQuerySchema,
  FileSliceQuerySchema,
  FileWindowResponseSchema,
  LIMITS,
  SearchRequestSchema,
  SseMetaSchema,
  TreeListingSchema,
} from "../src/index.ts";

describe("auth schemas", () => {
  it("parses login request and response", () => {
    expect(LoginRequestSchema.parse({ password: "secret1" })).toEqual({
      password: "secret1",
    });
    expect(LoginResponseSchema.parse({ token: "sess-abc" }).token).toBe(
      "sess-abc",
    );
    expect(
      LoginResponseSchema.parse({
        token: "sess-abc",
        expiresAt: 1_800_000_000_000,
      }).expiresAt,
    ).toBe(1_800_000_000_000);
    expect(AuthStatusSchema.parse({ authRequired: true })).toEqual({
      authRequired: true,
    });
  });

  it("rejects an empty password", () => {
    expect(LoginRequestSchema.safeParse({ password: "" }).success).toBe(false);
  });
});

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
      SearchRequestSchema.safeParse({
        query: "foo",
        maxResults: LIMITS.maxResultsHard + 1,
      }).success,
    ).toBe(false);
  });

  it("applies defaults on z.output", () => {
    const parsed = SearchRequestSchema.parse({ query: "foo" });
    expect(parsed.query).toBe("foo");
    expect(parsed.path).toBe("");
    expect(parsed.globInclude).toEqual([]);
    expect(parsed.globAnd).toEqual([]);
    expect(parsed.globExclude).toEqual([]);
    expect(parsed.regex).toBe(false);
    expect(parsed.caseSensitive).toBe(false);
    expect(parsed.wordMatch).toBe(false);
    expect(parsed.hidden).toBe(true);
    expect(parsed.maxResults).toBeUndefined();
    expect(parsed.mtimeAfter).toBeUndefined();
  });

  it("keeps globAnd and match modifiers on parse", () => {
    const parsed = SearchRequestSchema.parse({
      query: "Hello",
      globInclude: ["src/**"],
      globAnd: ["*.ts"],
      globExclude: ["*.test.ts"],
      caseSensitive: true,
      wordMatch: true,
      regex: true,
    });
    expect(parsed.globInclude).toEqual(["src/**"]);
    expect(parsed.globAnd).toEqual(["*.ts"]);
    expect(parsed.globExclude).toEqual(["*.test.ts"]);
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.wordMatch).toBe(true);
    expect(parsed.regex).toBe(true);
  });

  it("accepts mtimeAfter as unix milliseconds", () => {
    const parsed = SearchRequestSchema.parse({
      query: "foo",
      mtimeAfter: 1_726_300_000_000,
    });
    expect(parsed.mtimeAfter).toBe(1_726_300_000_000);
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

describe("FileSliceQuerySchema", () => {
  it("accepts path plus from/count", () => {
    const parsed = FileSliceQuerySchema.parse({
      path: "src/app.ts",
      from: 1,
      count: LIMITS.previewChunk,
    });
    expect(parsed.from).toBe(1);
    expect(parsed.count).toBe(LIMITS.previewChunk);
  });
});

describe("FileWindowResponseSchema", () => {
  it("defaults eof to false", () => {
    const parsed = FileWindowResponseSchema.parse({
      path: "a.ts",
      startLine: 1,
      lineCount: 1,
      truncated: false,
      binary: false,
      lines: [{ n: 1, text: "x" }],
    });
    expect(parsed.eof).toBe(false);
  });
});

describe("TreeListingSchema", () => {
  it("parses a directory listing", () => {
    const parsed = TreeListingSchema.parse({
      path: "",
      truncated: false,
      entries: [{ name: "src", path: "src", dir: true }],
    });
    expect(parsed.entries[0]?.dir).toBe(true);
  });
});

describe("ErrorCodeSchema", () => {
  it("rejects TIMEOUT", () => {
    expect(ErrorCodeSchema.safeParse("TIMEOUT").success).toBe(false);
  });
});
