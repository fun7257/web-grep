import { describe, expect, it } from "vitest";
import { pushSearchNav, sameSearchNav } from "../searchNav.ts";

const a = {
  parts: ["hello"],
  timeRange: "today" as const,
  caseSensitive: false,
  wordMatch: false,
  regex: false,
};
const b = { ...a, parts: ["hello", "world"] };

describe("searchNav", () => {
  it("pushes and drops the forward stack", () => {
    const once = pushSearchNav([], -1, a);
    expect(once.index).toBe(0);
    const twice = pushSearchNav(once.stack, once.index, b);
    expect(twice.index).toBe(1);
    const back = { stack: twice.stack, index: 0 };
    const branch = pushSearchNav(back.stack, back.index, {
      ...a,
      parts: ["other"],
    });
    expect(branch.stack.map((item) => item.parts[0])).toEqual(["hello", "other"]);
    expect(branch.index).toBe(1);
  });

  it("ignores a duplicate of the current entry", () => {
    const once = pushSearchNav([], -1, a);
    const again = pushSearchNav(once.stack, once.index, { ...a });
    expect(again.stack).toHaveLength(1);
    expect(sameSearchNav(a, a)).toBe(true);
  });
});
