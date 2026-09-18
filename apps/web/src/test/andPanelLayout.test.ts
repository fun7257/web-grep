import { describe, expect, it } from "vitest";
import { measureAndPanelWidth } from "../andPanelLayout.ts";

function box(left: number, width: number): { left: number; right: number } {
  return { left, right: left + width };
}

describe("measureAndPanelWidth", () => {
  it("spans the main query field left to the funnel button right", () => {
    const field = box(120, 220);
    const funnel = box(348, 40);
    const clip = box(0, 560);
    expect(measureAndPanelWidth(field, funnel, clip)).toBe(268);
  });

  it("clamps to the hits column so the panel cannot enter the preview pane", () => {
    const field = box(80, 200);
    const funnel = box(400, 40);
    const clip = box(0, 300);
    expect(measureAndPanelWidth(field, funnel, clip)).toBe(220);
    expect(80 + 220).toBeLessThanOrEqual(300);
  });

  it("returns 0 when layout boxes are unresolved", () => {
    expect(measureAndPanelWidth(box(0, 0), box(0, 0), box(0, 0))).toBe(0);
  });
});
