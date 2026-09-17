import { describe, expect, it } from "vitest";
import { pushSearchNav, sameSearchNav } from "../searchNav.ts";

const term = {
  value: "hello",
  caseSensitive: false,
  wordMatch: false,
  regex: false,
};
const a = {
  parts: [term],
  timeRange: "today" as const,
};
const b = {
  ...a,
  parts: [term, { ...term, value: "world" }],
};

describe("searchNav", () => {
  it("pushes and drops the forward stack", () => {
    const once = pushSearchNav([], -1, a);
    expect(once.index).toBe(0);
    const twice = pushSearchNav(once.stack, once.index, b);
    expect(twice.index).toBe(1);
    const back = { stack: twice.stack, index: 0 };
    const branch = pushSearchNav(back.stack, back.index, {
      ...a,
      parts: [{ ...term, value: "other" }],
    });
    expect(branch.stack.map((item) => item.parts[0]?.value)).toEqual([
      "hello",
      "other",
    ]);
    expect(branch.index).toBe(1);
  });

  it("ignores a duplicate of the current entry", () => {
    const once = pushSearchNav([], -1, a);
    const again = pushSearchNav(once.stack, once.index, { ...a });
    expect(again.stack).toHaveLength(1);
    expect(sameSearchNav(a, a)).toBe(true);
  });
});
