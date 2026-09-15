import { describe, expect, it } from "vitest";
import {
  compileParts,
  findMtimePredicate,
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
        rootAbs: "/tmp/project",
      }),
    ).toBe("( cd /tmp/project && rg -n -F -i --hidden -- hello . )");
  });

  it("quotes the query and path when needed", () => {
    expect(
      toRgShareCommand({
        query: "it's",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: false,
        rootAbs: "/tmp/my project",
        relPaths: ["file.ts"],
      }),
    ).toBe("( cd '/tmp/my project' && rg -n -s -w -- 'it'\\''s' file.ts )");
  });

  it("adds include and exclude globs with match modifiers", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: true,
        rootAbs: "/tmp/project",
        globInclude: ["*.ts", "src/**"],
        globExclude: ["*.test.ts"],
      }),
    ).toBe(
      "( cd /tmp/project && rg -n -s -w --hidden --glob '*.ts' --glob 'src/**' --glob '!*.test.ts' -- hello . )",
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
        rootAbs: "/tmp/project",
        relPaths: ["ok.txt", "src"],
        globInclude: ["*.ts"],
        globExclude: ["*.test.ts"],
      }),
    ).toBe(
      "( cd /tmp/project && rg -n -F -i --hidden --glob '*.ts' --glob '!*.test.ts' -- hello ok.txt src )",
    );
  });

  it("wraps find when a time range is set", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        timeRange: "7d",
      }),
    ).toBe(
      '( cd /tmp/project && find . -type f ! -path "*/.git/*" -mtime -7 -print0 | xargs -0 -r rg -n -F -i --hidden -- hello )',
    );
  });

  it("lists glob matches first so time filtering still respects include/exclude", () => {
    const mtime = findMtimePredicate("today");
    expect(
      toRgShareCommand({
        query: "hello",
        regex: true,
        caseSensitive: true,
        wordMatch: true,
        hidden: true,
        rootAbs: "/tmp/project",
        globInclude: ["*.ts"],
        globExclude: ["*.test.ts"],
        timeRange: "today",
      }),
    ).toBe(
      `( cd /tmp/project && rg --null --files --hidden --glob '*.ts' --glob '!*.test.ts' . | xargs -0 -r sh -c 'find "$@" -type f ! -path "*/.git/*" ${mtime} -print0' _ | xargs -0 -r rg -n -s -w --hidden -- hello )`,
    );
  });

  it("emits a find predicate for every time gear", () => {
    expect(findMtimePredicate("1h")).toBe("-mmin -60");
    expect(findMtimePredicate("24h")).toBe("-mmin -1440");
    expect(findMtimePredicate("7d")).toBe("-mtime -7");
    expect(findMtimePredicate("30d")).toBe("-mtime -30");
    expect(findMtimePredicate("today")).toContain("date +%H");
  });

  it("excludes tree picks via globs from the project root", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        relPaths: ["."],
        globExclude: ["skip.txt", "logs/**"],
      }),
    ).toBe(
      "( cd /tmp/project && rg -n -F -i --hidden --glob '!skip.txt' --glob '!logs/**' -- hello . )",
    );
  });

  it("joins a posix root with a relative hit path", () => {
    expect(joinAbs("/tmp/project/", "src/a.ts")).toBe("/tmp/project/src/a.ts");
  });
});
