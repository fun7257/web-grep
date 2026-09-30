import { describe, expect, it } from "vitest";
import {
  countFilledFilters,
  joinAbs,
  newPart,
  toRequest,
  toRgShareCommand,
} from "../searchStack.ts";

describe("toRequest", () => {
  it("forwards modifiers, globIntersect, and globExclude", () => {
    const req = toRequest({
      parts: [
        newPart("hello", {
          caseSensitive: true,
          wordMatch: true,
          regex: true,
        }),
      ],
      globInclude: ["src/**"],
      globIntersect: ["*.ts"],
      globExclude: ["*.test.ts"],
      path: "",
      caseSensitive: true,
      wordMatch: true,
      regex: true,
      hidden: true,
    });
    expect(req.query).toBe("hello");
    expect(req.globInclude).toEqual(["src/**"]);
    expect(req.globIntersect).toEqual(["*.ts"]);
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
      globIntersect: [],
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
    expect(req.filterTerms).toEqual([
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
      globIntersect: [],
      globExclude: [],
      path: "",
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      hidden: true,
    });
    expect(req.query).toBe("host");
    expect(req.filterTerms).toEqual([
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
        filterTerms: ["world"],
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
        filterTerms: ["industryType", "host"],
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
        filterTerms: [{ query: "world.*", regex: true }],
      }),
    ).toBe(
      "rg -n -F -s --hidden -- Hello /tmp/project/src/a.ts | rg -i -- 'world.*'",
    );
  });

  it("joins a posix root with a relative hit path", () => {
    expect(joinAbs("/tmp/project/", "src/a.ts")).toBe("/tmp/project/src/a.ts");
  });
});

describe("countFilledFilters", () => {
  it("counts only extra parts with a non-empty trimmed value", () => {
    expect(countFilledFilters([])).toBe(0);
    expect(countFilledFilters([newPart("hello")])).toBe(0);
    expect(
      countFilledFilters([
        newPart("hello"),
        newPart("filled"),
        newPart("also"),
        newPart(""),
        newPart("   "),
      ]),
    ).toBe(2);
  });
});
