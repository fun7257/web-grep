import { describe, expect, it } from "vitest";
import {
  compileParts,
  formatQueryInput,
  joinAbs,
  newPart,
  parseQueryInput,
  stackedQuery,
  toRequest,
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

describe("parseQueryInput", () => {
  it("keeps spaces inside a single term", () => {
    expect(parseQueryInput("hello world")).toEqual(["hello world"]);
    expect(parseQueryInput("  err msg  ")).toEqual(["err msg"]);
  });

  it("splits only on the AND keyword", () => {
    expect(parseQueryInput("hello AND world")).toEqual(["hello", "world"]);
    expect(parseQueryInput("hello world AND timeout")).toEqual([
      "hello world",
      "timeout",
    ]);
    expect(parseQueryInput('"failed AND retry" AND timeout')).toEqual([
      "failed AND retry",
      "timeout",
    ]);
  });

  it("keeps a regex pattern intact", () => {
    expect(parseQueryInput("foo bar", true)).toEqual(["foo bar"]);
  });
});

describe("formatQueryInput", () => {
  it("joins extra terms with AND and leaves spaces in a single term", () => {
    expect(formatQueryInput(["hello world"])).toBe("hello world");
    expect(formatQueryInput(["hello world", "timeout"])).toBe(
      "hello world AND timeout",
    );
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

describe("toRequest", () => {
  it("forwards modifiers, globAnd, and globExclude", () => {
    const req = toRequest({
      parts: [newPart("hello")],
      globInclude: ["src/**"],
      globAnd: ["*.ts"],
      globExclude: ["*.test.ts"],
      path: "",
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      hidden: true,
    });
    expect(req.query).toBe("hello");
    expect(req.globInclude).toEqual(["src/**"]);
    expect(req.globAnd).toEqual(["*.ts"]);
    expect(req.globExclude).toEqual(["*.test.ts"]);
    expect(req.caseSensitive).toBe(true);
    expect(req.wordMatch).toBe(true);
    expect(req.regex).toBe(true);
  });
});

describe("toRgShareCommand", () => {
  it("searches the project root, not a single hit line", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        paths: ["/tmp/project"],
      }),
    ).toBe("rg -n -F -i --hidden -- hello /tmp/project");
  });

  it("quotes the query and path when needed", () => {
    expect(
      toRgShareCommand({
        query: "it's",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: false,
        paths: ["/tmp/my project/file.ts"],
      }),
    ).toBe("rg -n -s -w -- 'it'\\''s' '/tmp/my project/file.ts'");
  });

  it("adds include and exclude globs with match modifiers", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: true,
        paths: ["/tmp/project"],
        globInclude: ["*.ts", "src/**"],
        globExclude: ["*.test.ts"],
      }),
    ).toBe(
      "rg -n -s -w --hidden --glob '*.ts' --glob 'src/**' --glob '!*.test.ts' -- hello /tmp/project",
    );
  });

  it("searches picked files as paths so globs still apply to folders", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        paths: ["/tmp/project/ok.txt", "/tmp/project/src"],
        globInclude: ["*.ts"],
        globExclude: ["*.test.ts"],
      }),
    ).toBe(
      "rg -n -F -i --hidden --glob '*.ts' --glob '!*.test.ts' -- hello /tmp/project/ok.txt /tmp/project/src",
    );
  });

  it("joins a posix root with a relative hit path", () => {
    expect(joinAbs("/tmp/project/", "src/a.ts")).toBe("/tmp/project/src/a.ts");
  });
});
