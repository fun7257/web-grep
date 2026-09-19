import { describe, expect, it } from "vitest";
import { rangeForLine } from "../fileWindow.ts";

describe("rangeForLine", () => {
  it("keeps count at most maxCount and still includes the target", () => {
    expect(rangeForLine(1, 160)).toEqual({ from: 1, count: 160 });
    expect(rangeForLine(1000, 160)).toEqual({ from: 841, count: 160 });
    expect(rangeForLine(1000, 160, 400)).toEqual({ from: 840, count: 320 });
    expect(rangeForLine(50, 160)).toEqual({ from: 1, count: 160 });
    expect(rangeForLine(50, 160, 400)).toEqual({ from: 1, count: 209 });
    expect(rangeForLine(5, 3)).toEqual({ from: 3, count: 3 });
    const tight = rangeForLine(1000, 400, 160);
    expect(tight.count).toBe(160);
    expect(tight.from).toBe(841);
    expect(tight.from).toBeLessThanOrEqual(1000);
    expect(tight.from + tight.count - 1).toBeGreaterThanOrEqual(1000);
  });
});
