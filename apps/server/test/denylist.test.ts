import { describe, expect, it } from "vitest";
import {
  assertGlobIncludeAllowed,
  denylistRgGlobs,
  GlobError,
  isDenied,
  sanitizeUserGlob,
} from "../src/sandbox/denylist.ts";

describe("isDenied", () => {
  it("excludes *.pem via basename and full path", () => {
    expect(isDenied("foo.pem", false)).toBe(true);
    expect(isDenied("certs/foo.pem", false)).toBe(true);
  });

  it("includes .env.example as an allow-exception", () => {
    expect(isDenied(".env.example", false)).toBe(false);
    expect(isDenied("config/.env.example", false)).toBe(false);
  });

  it("denies .env", () => {
    expect(isDenied(".env", false)).toBe(true);
  });

  it("is a no-op when allowSecrets is true", () => {
    expect(isDenied(".env", true)).toBe(false);
    expect(isDenied("foo.pem", true)).toBe(false);
  });
});

describe("sanitizeUserGlob", () => {
  it("rejects --help", () => {
    expect(() => sanitizeUserGlob("--help")).toThrow(GlobError);
  });

  it("rejects negated !.env", () => {
    expect(() => sanitizeUserGlob("!.env")).toThrow(GlobError);
  });

  it("accepts **/a", () => {
    expect(sanitizeUserGlob("**/a")).toBe("**/a");
  });
});

describe("globInclude denylist", () => {
  it("denies globInclude .env", () => {
    expect(() => assertGlobIncludeAllowed(".env", false)).toThrow(GlobError);
    expect(isDenied(".env", false)).toBe(true);
  });
});

describe("denylistRgGlobs", () => {
  it("emits negated globs then the .env.example allow-exception", () => {
    const globs = denylistRgGlobs(false);
    expect(globs.at(-1)).toBe(".env.example");
    expect(globs[0]?.startsWith("!")).toBe(true);
    expect(denylistRgGlobs(true)).toEqual([]);
  });
});
