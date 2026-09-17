import { describe, expect, it } from "vitest";
import {
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
});

describe("picksToSearchGlobs", () => {
  const file = [{ path: "ok.txt", dir: false }];
  const folder = [{ path: "logs", dir: true }];

  it("maps picks to globInclude and typed patterns to globExclude", () => {
    expect(picksToSearchGlobs(file)).toEqual({
      globInclude: ["ok.txt"],
      globExclude: [],
    });
    expect(picksToSearchGlobs(folder)).toEqual({
      globInclude: ["logs/**"],
      globExclude: [],
    });
    expect(picksToSearchGlobs([])).toEqual({
      globInclude: [],
      globExclude: [],
    });
    expect(picksToSearchGlobs(file, [], ["*.test.ts"])).toEqual({
      globInclude: ["ok.txt"],
      globExclude: ["*.test.ts"],
    });
  });

  it("pins extraInclude over picks and keeps typed exclude", () => {
    expect(picksToSearchGlobs(file, ["src/a.ts"], ["*.test.ts"])).toEqual({
      globInclude: ["src/a.ts"],
      globExclude: ["*.test.ts"],
    });
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
