import { describe, expect, it } from "vitest";
import {
  compileParts,
  joinAbs,
  newPart,
  stackedQuery,
  toRgShareCommand,
} from "../searchStack.ts";

describe("stackedQuery", () => {
  it("keeps a single term as a literal", () => {
    expect(stackedQuery(["account"])).toEqual({
      query: "account",
      regex: false,
    });
  });

  it("ands two terms without lookahead", () => {
    const got = stackedQuery(["account", "308b85351438c15a"]);
    expect(got.regex).toBe(true);
    expect(got.query).not.toContain("(?=");
    expect(got.query).toContain("account.*308b85351438c15a");
    expect(got.query).toContain("308b85351438c15a.*account");
  });
});

describe("compileParts", () => {
  it("ands chip values", () => {
    const got = compileParts([newPart("foo"), newPart("bar")]);
    expect(got.regex).toBe(true);
    expect(got.query).toContain("foo.*bar");
  });

  it("forces regex when forceRegex flag is passed", () => {
    const got = compileParts([newPart("fn.*test")], true);
    expect(got.regex).toBe(true);
    expect(got.query).toBe("fn.*test");
  });
});

describe("toRgShareCommand", () => {
  it("builds a literal command with an absolute file path", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        absPath: "/tmp/project/src/a.ts",
        line: 1,
      }),
    ).toBe("rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:'");
  });

  it("quotes the query and path when needed", () => {
    expect(
      toRgShareCommand({
        query: "it's",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: false,
        absPath: "/tmp/my project/file.ts",
      }),
    ).toBe("rg -n -s -w -- 'it'\\''s' '/tmp/my project/file.ts'");
  });

  it("joins a posix root with a relative hit path", () => {
    expect(joinAbs("/tmp/project/", "src/a.ts")).toBe("/tmp/project/src/a.ts");
  });
});
