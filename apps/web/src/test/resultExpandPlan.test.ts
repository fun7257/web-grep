import { describe, expect, it } from "vitest";
import {
  absorbAnchorShift,
  hitExpandKey,
  pickReleaseAnchor,
  pointerRestBlocked,
  type VisibleHitBox,
} from "../resultExpandPlan.ts";

describe("pointerRestBlocked", () => {
  it("blocks while scrolling and while the pointer is outside", () => {
    expect(pointerRestBlocked(true, true)).toBe(true);
    expect(pointerRestBlocked(false, false)).toBe(true);
    expect(pointerRestBlocked(true, false)).toBe(true);
    expect(pointerRestBlocked(false, true)).toBe(false);
  });
});

function box(index: number, top: number, height: number): VisibleHitBox {
  return {
    index,
    key: hitExpandKey(index),
    top,
    bottom: top + height,
  };
}

describe("pickReleaseAnchor", () => {
  const rows = [box(0, 10, 40), box(2, 80, 40), box(4, 700, 40)];

  it("keeps the last pointer hit when that key is still in the viewport", () => {
    expect(
      pickReleaseAnchor({ index: 2, key: hitExpandKey(2) }, rows, 0, 600),
    ).toEqual({ index: 2, key: hitExpandKey(2) });
  });

  it("falls through to the first visible hit when the last pointer row has left the viewport", () => {
    expect(
      pickReleaseAnchor({ index: 4, key: hitExpandKey(4) }, rows, 0, 600),
    ).toEqual({ index: 0, key: hitExpandKey(0) });
  });

  it("does not pin a stable key the new row set dropped", () => {
    expect(
      pickReleaseAnchor({ index: 9, key: hitExpandKey(9) }, rows, 0, 600),
    ).toEqual({ index: 0, key: hitExpandKey(0) });
    expect(
      pickReleaseAnchor({ index: 9, key: hitExpandKey(9) }, [], 0, 600),
    ).toBeNull();
  });

  it("uses the row found by key, not a stale index", () => {
    const moved = [{ ...box(5, 40, 30), key: hitExpandKey(2) }];
    expect(
      pickReleaseAnchor({ index: 2, key: hitExpandKey(2) }, moved, 0, 200),
    ).toEqual({ index: 5, key: hitExpandKey(2) });
  });
});

describe("absorbAnchorShift", () => {
  it("returns the full shift when scrollTop can absorb it", () => {
    expect(absorbAnchorShift(500, -259, 2400)).toBe(-259);
    expect(absorbAnchorShift(80, 40, 2400)).toBe(40);
  });

  it("returns 0 when scrollTop is already at the limit", () => {
    expect(absorbAnchorShift(0, -259, 2400)).toBe(0);
    expect(absorbAnchorShift(2400, 80, 2400)).toBe(0);
    expect(absorbAnchorShift(0, -10, 0)).toBe(0);
  });

  it("returns only the part scrollTop can absorb", () => {
    expect(absorbAnchorShift(50, -259, 2400)).toBe(-50);
    expect(absorbAnchorShift(2300, 200, 2400)).toBe(100);
  });

  it("ignores a shift inside the slop and a non-finite shift", () => {
    expect(absorbAnchorShift(100, 0.4, 2400)).toBe(0);
    expect(absorbAnchorShift(100, -1, 2400)).toBe(0);
    expect(absorbAnchorShift(100, Number.NaN, 2400)).toBe(0);
  });
});
