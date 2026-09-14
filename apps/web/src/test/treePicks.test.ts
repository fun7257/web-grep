import { describe, expect, it } from "vitest";
import {
  pickMark,
  picksToGlobs,
  picksToSearchGlobs,
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

  it("uses current picks for include and nothing after clear", () => {
    expect(picksToSearchGlobs(file, "include")).toEqual({
      globInclude: ["ok.txt"],
      globExclude: [],
    });
    expect(picksToSearchGlobs(folder, "include")).toEqual({
      globInclude: ["logs/**"],
      globExclude: [],
    });
    expect(picksToSearchGlobs([], "all")).toEqual({
      globInclude: [],
      globExclude: [],
    });
  });

  it("puts picks in globExclude when excluding", () => {
    expect(picksToSearchGlobs(file, "exclude")).toEqual({
      globInclude: [],
      globExclude: ["ok.txt"],
    });
  });

  it("does not keep a previous range when picks are empty", () => {
    expect(picksToSearchGlobs([], "include", [], ["stale.txt"])).toEqual({
      globInclude: ["stale.txt"],
      globExclude: [],
    });
    expect(picksToSearchGlobs([], "all")).toEqual({
      globInclude: [],
      globExclude: [],
    });
  });
});
