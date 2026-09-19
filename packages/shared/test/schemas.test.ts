import { describe, expect, it } from "vitest";
import {
  AuthStatusSchema,
  CountQuerySchema,
  CountResponseSchema,
  ErrorCodeSchema,
  FileQuerySchema,
  FileSliceQuerySchema,
  FileWindowResponseSchema,
  HealthResponseSchema,
  JsonErrorSchema,
  LIMITS,
  LoginRequestSchema,
  LoginResponseSchema,
  MetaResponseSchema,
  mapLegacyErrorCode,
  SearchRequestSchema,
  SseMetaSchema,
  TreeListingSchema,
  TreeQuerySchema,
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
    expect(parsed.andTerms).toEqual([]);
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

  it("accepts object andTerms with per-term modifiers", () => {
    const parsed = SearchRequestSchema.parse({
      query: "Hello",
      andTerms: [{ query: "world.*", regex: true }, "plain"],
    });
    expect(parsed.andTerms).toEqual([
      { query: "world.*", regex: true },
      "plain",
    ]);
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
        engine: "rg",
      }).success,
    ).toBe(false);
  });

  it("accepts engine none and rejects literal", () => {
    expect(
      SseMetaSchema.safeParse({
        searchId: "550e8400-e29b-41d4-a716-446655440000",
        engine: "none",
      }).success,
    ).toBe(true);
    expect(
      SseMetaSchema.safeParse({
        searchId: "550e8400-e29b-41d4-a716-446655440000",
        engine: "literal",
      }).success,
    ).toBe(false);
  });
});

describe("MetaResponseSchema", () => {
  const base = {
    rgVersion: "14.1.0",
    rootLabel: "project",
    root: "/tmp/project",
    followSymlinks: false,
    limits: {
      maxResults: 10_000,
      maxResultsHard: 50_000,
      timeoutMs: 30_000,
      previewBytes: 1_048_576,
      previewLines: 201,
      queryMaxChars: 512,
    },
    defaultLocale: "zh-CN",
    authRequired: false,
  };

  it("accepts engine rg or none and rejects literal", () => {
    expect(
      MetaResponseSchema.safeParse({ ...base, engine: "rg" }).success,
    ).toBe(true);
    expect(
      MetaResponseSchema.safeParse({ ...base, engine: "none" }).success,
    ).toBe(true);
    expect(
      MetaResponseSchema.safeParse({ ...base, engine: "literal" }).success,
    ).toBe(false);
  });

  it("keeps current limits without previewChunk and accepts them when present", () => {
    const without = MetaResponseSchema.parse({ ...base, engine: "rg" });
    expect(without.limits.previewChunk).toBeUndefined();
    expect(without.limits.previewChunkMax).toBeUndefined();
    expect(without.limits.previewLines).toBe(201);

    const withChunk = MetaResponseSchema.parse({
      ...base,
      engine: "rg",
      limits: {
        ...base.limits,
        previewChunk: 80,
        previewChunkMax: 200,
      },
    });
    expect(withChunk.limits.previewChunk).toBe(80);
    expect(withChunk.limits.previewChunkMax).toBe(200);
    expect(withChunk.limits.previewLines).toBe(201);
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
    expect(parsed.tail).toBeUndefined();
  });

  it("accepts optional tail (frontend sends tail=1)", () => {
    const parsed = FileSliceQuerySchema.parse({
      path: "src/app.ts",
      count: LIMITS.previewChunk,
      tail: true,
    });
    expect(parsed.tail).toBe(true);
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

describe("TreeQuerySchema", () => {
  it("defaults exclude to [] and leaves include optional", () => {
    const parsed = TreeQuerySchema.parse({ path: "src" });
    expect(parsed.path).toBe("src");
    expect(parsed.exclude).toEqual([]);
    expect(parsed.include).toBeUndefined();
  });

  it("accepts exclude and optional include arrays", () => {
    const parsed = TreeQuerySchema.parse({
      path: "",
      mtimeAfter: 1_726_300_000_000,
      exclude: ["*.test.ts", "dist/**"],
      include: ["src/**"],
    });
    expect(parsed.exclude).toEqual(["*.test.ts", "dist/**"]);
    expect(parsed.include).toEqual(["src/**"]);
    expect(parsed.mtimeAfter).toBe(1_726_300_000_000);
  });
});

describe("Count schemas", () => {
  it("parses the same query filters as tree", () => {
    const parsed = CountQuerySchema.parse({
      path: "apps",
      exclude: ["node_modules/**"],
    });
    expect(parsed.path).toBe("apps");
    expect(parsed.exclude).toEqual(["node_modules/**"]);
    expect(parsed.include).toBeUndefined();
  });

  it("parses { count }", () => {
    expect(CountResponseSchema.parse({ count: 12 })).toEqual({ count: 12 });
    expect(CountResponseSchema.safeParse({ count: -1 }).success).toBe(false);
  });
});

describe("HealthResponseSchema", () => {
  it("accepts engine rg or none", () => {
    expect(HealthResponseSchema.parse({ ok: true, engine: "rg" })).toEqual({
      ok: true,
      engine: "rg",
    });
    expect(
      HealthResponseSchema.safeParse({ ok: true, engine: "none" }).success,
    ).toBe(true);
    expect(
      HealthResponseSchema.safeParse({ ok: true, engine: "literal" }).success,
    ).toBe(false);
  });
});

describe("ErrorCodeSchema", () => {
  it("rejects TIMEOUT", () => {
    expect(ErrorCodeSchema.safeParse("TIMEOUT").success).toBe(false);
  });

  it("does not advertise ENGINE_UNSUPPORTED; clients map it to ENGINE", () => {
    expect(ErrorCodeSchema.safeParse("ENGINE_UNSUPPORTED").success).toBe(false);
    expect(mapLegacyErrorCode("ENGINE_UNSUPPORTED")).toBe("ENGINE");
    expect(mapLegacyErrorCode("ENGINE")).toBe("ENGINE");
    const mapped = JsonErrorSchema.parse({
      code: "ENGINE_UNSUPPORTED",
      message: "ripgrep is not available",
    });
    expect(mapped.code).toBe("ENGINE");
  });
});
