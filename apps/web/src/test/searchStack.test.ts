import { describe, expect, it } from "vitest";
import {
  compileParts,
  countNonEmptyAndTerms,
  findMtimePredicate,
  formatQueryInput,
  joinAbs,
  newPart,
  parseQueryInput,
  splitAndTerms,
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
      parts: [
        newPart("hello", {
          caseSensitive: true,
          wordMatch: true,
          regex: true,
        }),
      ],
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

  it("sends per-term modifiers on piped AND terms", () => {
    const req = toRequest({
      parts: [
        newPart("Hello", { caseSensitive: true }),
        newPart("world.*", { regex: true }),
      ],
      globInclude: [],
      globAnd: [],
      globExclude: [],
      path: "",
      caseSensitive: true,
      wordMatch: false,
      regex: false,
      hidden: true,
    });
    expect(req.query).toBe("Hello");
    expect(req.caseSensitive).toBe(true);
    expect(req.regex).toBe(false);
    expect(req.andTerms).toEqual([
      {
        query: "world.*",
        regex: true,
        caseSensitive: false,
        wordMatch: false,
      },
    ]);
  });

  it("sends extra AND terms instead of an ordered regex", () => {
    const req = toRequest({
      parts: [
        newPart("host"),
        newPart("030680228968"),
        newPart("industryType"),
        newPart("trade-users"),
      ],
      globInclude: [],
      globAnd: [],
      globExclude: [],
      path: "",
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      hidden: true,
    });
    expect(req.query).toBe("host");
    expect(req.andTerms).toEqual([
      {
        query: "030680228968",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
      },
      {
        query: "industryType",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
      },
      {
        query: "trade-users",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
      },
    ]);
    expect(req.regex).toBe(false);
  });
});

describe("splitAndTerms", () => {
  it("keeps the typed order for a piped rg chain", () => {
    expect(
      splitAndTerms(["host", "030680228968", "industryType", "trade-users"]),
    ).toEqual({
      query: "host",
      andTerms: ["030680228968", "industryType", "trade-users"],
    });
  });
});

describe("toRgShareCommand", () => {
  it("searches the shared hit file by explicit path", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        relPaths: ["src/a.ts"],
      }),
    ).toBe("rg -n -F -i --hidden -- hello /tmp/project/src/a.ts");
  });

  it("keeps original line numbers through the pipe and locks the hit line", () => {
    expect(
      toRgShareCommand({
        query: "hello",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        relPaths: ["src/a.ts"],
        andTerms: ["world"],
        line: 12,
      }),
    ).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg -F -i -- world | rg '^12:' -r ''",
    );
  });

  it("pipes extra AND terms after the explicit file search", () => {
    expect(
      toRgShareCommand({
        query: "030680228968",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        relPaths: ["test.log"],
        andTerms: ["industryType", "host"],
      }),
    ).toBe(
      "rg -n -F -i --hidden -- 030680228968 /tmp/project/test.log | rg -F -i -- industryType | rg -F -i -- host",
    );
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
    ).toBe("rg -n -s -w -- 'it'\\''s' '/tmp/my project/file.ts'");
  });

  it("uses per-term flags on piped AND stages", () => {
    expect(
      toRgShareCommand({
        query: "Hello",
        regex: false,
        caseSensitive: true,
        wordMatch: false,
        hidden: true,
        rootAbs: "/tmp/project",
        relPaths: ["src/a.ts"],
        andTerms: [{ query: "world.*", regex: true }],
      }),
    ).toBe(
      "rg -n -F -s --hidden -- Hello /tmp/project/src/a.ts | rg -i -- 'world.*'",
    );
  });

  it("emits a find predicate for every time gear", () => {
    expect(findMtimePredicate("24h")).toBe("-mmin -1440");
    expect(findMtimePredicate("7d")).toBe("-mtime -7");
    expect(findMtimePredicate("today")).toContain("date +%H");
  });

  it("joins a posix root with a relative hit path", () => {
    expect(joinAbs("/tmp/project/", "src/a.ts")).toBe("/tmp/project/src/a.ts");
  });
});

describe("countNonEmptyAndTerms", () => {
  it("counts only extra parts with a non-empty trimmed value", () => {
    expect(countNonEmptyAndTerms([])).toBe(0);
    expect(countNonEmptyAndTerms([newPart("hello")])).toBe(0);
    expect(
      countNonEmptyAndTerms([
        newPart("hello"),
        newPart("filled"),
        newPart("also"),
        newPart(""),
        newPart("   "),
      ]),
    ).toBe(2);
  });
});
