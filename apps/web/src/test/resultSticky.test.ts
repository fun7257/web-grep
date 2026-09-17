import { describe, expect, it } from "vitest";
import { pickSticky } from "../resultSticky.ts";

const a = { index: 0, start: 0, path: "a.ts", count: 3 };
const b = { index: 4, start: 400, path: "b.ts", count: 2 };

describe("pickSticky", () => {
  it("keeps the first file at the top", () => {
    expect(pickSticky([a, b], 0, 40)).toEqual({
      path: "a.ts",
      count: 3,
      shift: 0,
      pushing: false,
      enteringIndex: null,
    });
  });

  it("keeps the first file while scrolled through its hits", () => {
    expect(pickSticky([a, b], 120, 40)?.path).toBe("a.ts");
  });

  it("pushes the current file up as the next header enters the freeze slot", () => {
    const pick = pickSticky([a, b], 380, 40);
    expect(pick).toEqual({
      path: "a.ts",
      count: 3,
      shift: -20,
      pushing: true,
      enteringIndex: 4,
    });
  });

  it("lands on the next file once its header reaches the top", () => {
    expect(pickSticky([a, b], 400, 40)).toEqual({
      path: "b.ts",
      count: 2,
      shift: 0,
      pushing: false,
      enteringIndex: null,
    });
  });

  it("does not skip the first collapsed header when it fills the freeze slot", () => {
    const first = { index: 0, start: 0, path: "a.ts", count: 3 };
    const second = { index: 1, start: 40, path: "b.ts", count: 2 };
    expect(pickSticky([first, second], 0, 40)?.path).toBe("a.ts");
  });
});
