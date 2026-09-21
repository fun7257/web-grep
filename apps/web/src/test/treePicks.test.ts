import { describe, expect, it } from "vitest";
import {
  pickChipLabel,
  pickMark,
  picksToGlobs,
  picksToSearchGlobs,
  prunePicksByExclude,
  togglePick,
} from "../treePicks.ts";

const kids = [
  { path: "logs/a.log", dir: false },
  { path: "logs/b.log", dir: false },
];

describe("pickChipLabel", () => {
  it("appends a trailing slash to folder picks only", () => {
    expect(pickChipLabel({ path: "apps", dir: true })).toBe("apps/");
    expect(pickChipLabel({ path: "packages", dir: true })).toBe("packages/");
    expect(pickChipLabel({ path: "packages/legacy", dir: true })).toBe(
      "legacy/",
    );
    expect(pickChipLabel({ path: "apps/", dir: true })).toBe("apps/");
    expect(pickChipLabel({ path: "package.json", dir: false })).toBe(
      "package.json",
    );
    expect(pickChipLabel({ path: "apps/web/src/main.ts", dir: false })).toBe(
      "main.ts",
    );
  });
});

describe("pickMark", () => {
  it("marks files inside a picked folder as covered", () => {
    const picks = [{ path: "logs", dir: true }];
    expect(pickMark("logs", true, picks, kids)).toBe("on");
    expect(pickMark("logs/a.log", false, picks)).toBe("covered");
    expect(pickMark("logs/nested/b.log", false, picks)).toBe("covered");
    expect(pickMark("other.log", false, picks)).toBe("off");
  });

  it("marks a folder partial when only some children are picked", () => {
    const picks = [{ path: "logs/a.log", dir: false }];
    expect(pickMark("logs", true, picks, kids)).toBe("partial");
    expect(pickMark("logs/a.log", false, picks)).toBe("on");
    expect(pickMark("logs/b.log", false, picks)).toBe("off");
  });

  it("marks a folder on when every listed child is picked", () => {
    const picks = [
      { path: "logs/a.log", dir: false },
      { path: "logs/b.log", dir: false },
    ];
    expect(pickMark("logs", true, picks, kids)).toBe("on");
    expect(pickMark("logs/a.log", false, picks)).toBe("on");
  });

  it("stays partial when children are not loaded", () => {
    const picks = [
      { path: "logs/a.log", dir: false },
      { path: "logs/b.log", dir: false },
    ];
    expect(pickMark("logs", true, picks, null)).toBe("partial");
  });

  it("stays partial when the listing is truncated", () => {
    const picks = [
      { path: "logs/a.log", dir: false },
      { path: "logs/b.log", dir: false },
    ];
    expect(pickMark("logs", true, picks, kids, true)).toBe("partial");
  });
});

describe("togglePick", () => {
  it("adds and removes a path", () => {
    const once = togglePick([], { path: "a.log", dir: false });
    expect(once).toEqual([{ path: "a.log", dir: false }]);
    expect(togglePick(once, { path: "a.log", dir: false })).toEqual([]);
  });

  it("clears descendant file picks when clicking a fully selected folder", () => {
    const picks = [
      { path: "logs/a.log", dir: false },
      { path: "logs/b.log", dir: false },
    ];
    expect(togglePick(picks, { path: "logs", dir: true }, kids)).toEqual([]);
  });

  it("promotes a partial folder click to the whole folder", () => {
    const picks = [{ path: "logs/a.log", dir: false }];
    expect(togglePick(picks, { path: "logs", dir: true }, kids)).toEqual([
      { path: "logs", dir: true },
    ]);
  });

  it("promotes a truncated folder instead of clearing the visible files", () => {
    const picks = [
      { path: "logs/a.log", dir: false },
      { path: "logs/b.log", dir: false },
    ];
    expect(togglePick(picks, { path: "logs", dir: true }, kids, null, true)).toEqual(
      [{ path: "logs", dir: true }],
    );
  });

  it("unchecks a file inside a picked folder by exploding siblings", () => {
    const picks = [{ path: "logs", dir: true }];
    expect(
      togglePick(picks, { path: "logs/a.log", dir: false }, kids, kids),
    ).toEqual([{ path: "logs/b.log", dir: false }]);
  });

  it("keeps other branches when unchecking a nested covered file", () => {
    const cover = [
      { path: "logs/a.log", dir: false },
      { path: "logs/nested", dir: true },
    ];
    const siblings = [
      { path: "logs/nested/x.log", dir: false },
      { path: "logs/nested/y.log", dir: false },
    ];
    const picks = [{ path: "logs", dir: true }];
    const next = togglePick(
      picks,
      { path: "logs/nested/x.log", dir: false },
      siblings,
      cover,
    );
    expect(next).toEqual([
      { path: "logs/a.log", dir: false },
      { path: "logs/nested/y.log", dir: false },
    ]);
  });
});

describe("picksToGlobs", () => {
  it("expands folders to a recursive glob", () => {
    expect(picksToGlobs([{ path: "logs", dir: true }])).toEqual(["logs/**"]);
    expect(picksToGlobs([{ path: "a.log", dir: false }])).toEqual(["a.log"]);
    expect(picksToGlobs([{ path: "src/a.ts", dir: false }])).toEqual([
      "src/a.ts",
    ]);
  });

  it("escapes glob syntax so same-named files stay literal paths", () => {
    expect(
      picksToGlobs([
        { path: "app/[id]/page.tsx", dir: false },
        { path: "pkg/[id]/page.tsx", dir: false },
      ]),
    ).toEqual(["app/\\[id\\]/page.tsx", "pkg/\\[id\\]/page.tsx"]);
    expect(picksToGlobs([{ path: "app/[id]", dir: true }])).toEqual([
      "app/\\[id\\]/**",
    ]);
    expect(
      picksToGlobs([
        { path: "a/{id}/page.tsx", dir: false },
        { path: "b/{id}/page.tsx", dir: false },
      ]),
    ).toEqual(["a/\\{id\\}/page.tsx", "b/\\{id\\}/page.tsx"]);
  });
});

describe("picksToSearchGlobs", () => {
  const file = [{ path: "ok.txt", dir: false }];
  const folder = [{ path: "logs", dir: true }];

  it("maps picks to globInclude and typed patterns to globExclude", () => {
    expect(picksToSearchGlobs(file)).toEqual({
      globInclude: ["ok.txt"],
      globExclude: [],
      omitted: [],
      blocked: false,
    });
    expect(picksToSearchGlobs(folder)).toEqual({
      globInclude: ["logs/**"],
      globExclude: [],
      omitted: [],
      blocked: false,
    });
    expect(picksToSearchGlobs([])).toEqual({
      globInclude: [],
      globExclude: [],
      omitted: [],
      blocked: false,
    });
    expect(picksToSearchGlobs(file, [], ["*.test.ts"])).toEqual({
      globInclude: ["ok.txt"],
      globExclude: ["*.test.ts"],
      omitted: [],
      blocked: false,
    });
  });

  it("pins extraInclude over picks and keeps typed exclude", () => {
    expect(picksToSearchGlobs(file, ["src/a.ts"], ["*.test.ts"])).toEqual({
      globInclude: ["src/a.ts"],
      globExclude: ["*.test.ts"],
      omitted: [],
      blocked: false,
    });
  });

  it("keeps a truncated folder and excludes the unchecked file", () => {
    const picks = [{ path: "logs", dir: true }];
    const next = togglePick(
      picks,
      { path: "logs/a.log", dir: false },
      kids,
      kids,
      true,
    );
    expect(next).toEqual([
      { path: "logs", dir: true },
      { path: "logs/a.log", dir: false, exclude: true },
    ]);
    expect(pickMark("logs", true, next, kids, true)).toBe("partial");
    expect(pickMark("logs/a.log", false, next)).toBe("off");
    expect(pickMark("logs/b.log", false, next)).toBe("covered");
    expect(picksToSearchGlobs(next)).toEqual({
      globInclude: ["logs/**"],
      globExclude: ["logs/a.log"],
      omitted: [],
      blocked: false,
    });
    expect(
      togglePick(next, { path: "logs/a.log", dir: false }, kids, kids, true),
    ).toEqual(picks);
  });

  it("skips one overlong include and blocks when every include is overlong", () => {
    const long = "a/".padEnd(300, "x");
    const picks = [
      { path: "ok.txt", dir: false },
      { path: long, dir: false },
    ];
    const mixed = picksToSearchGlobs(picks);
    expect(mixed.globInclude).toEqual(["ok.txt"]);
    expect(mixed.blocked).toBe(false);
    expect(mixed.omitted).toHaveLength(1);
    const only = picksToSearchGlobs([{ path: long, dir: false }]);
    expect(only.blocked).toBe(true);
    expect(only.globInclude).toEqual([]);
  });
});

describe("prunePicksByExclude", () => {
  it("drops file picks that match exclude globs", () => {
    const picks = [
      { path: "ok.txt", dir: false },
      { path: "skip.log", dir: false },
      { path: "dir/app.log", dir: false },
    ];
    expect(prunePicksByExclude(picks, ["*.log"])).toEqual([
      { path: "ok.txt", dir: false },
    ]);
  });

  it("drops a folder pick when exclude covers the whole folder", () => {
    expect(
      prunePicksByExclude([{ path: "logs", dir: true }], ["logs/**"]),
    ).toEqual([]);
    expect(
      prunePicksByExclude([{ path: "logs", dir: true }], ["*.log"]),
    ).toEqual([{ path: "logs", dir: true }]);
  });

  it("returns the same array when nothing is excluded", () => {
    const picks = [{ path: "ok.txt", dir: false }];
    expect(prunePicksByExclude(picks, [])).toBe(picks);
    expect(prunePicksByExclude(picks, ["*.log"])).toBe(picks);
  });
});
