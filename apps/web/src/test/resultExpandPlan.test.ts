import { describe, expect, it } from "vitest";
import {
  absorbAnchorShift,
  decideRetainedRows,
  hitExpandKey,
  pickReleaseAnchor,
  PIN_SLOP_PX,
  pointerRestBlocked,
  type OpenRowLayout,
  type VisibleHitBox,
} from "../resultExpandPlan.ts";

function row(
  index: number,
  start: number,
  shrink: number,
): OpenRowLayout {
  return { index, start, shrink };
}

describe("decideRetainedRows", () => {
  it("keeps an above row when scrollTop cannot absorb its shrink", () => {
    const decision = decideRetainedRows(0, 400, [row(1, 40, 219.39)]);
    expect(decision.retain).toEqual([1]);
    expect(decision.collapse).toEqual([]);
    expect(decision.shrink).toBe(0);
  });

  it("keeps the row when scrollTop is positive but short of the shrink", () => {
    const decision = decideRetainedRows(100, 400, [row(1, 40, 219)]);
    expect(decision.retain).toEqual([1]);
    expect(decision.collapse).toEqual([]);
  });

  it("collapses an above row when scrollTop covers the shrink within 1px", () => {
    const exact = decideRetainedRows(219, 400, [row(1, 40, 219)]);
    expect(exact.collapse).toEqual([1]);
    expect(exact.retain).toEqual([]);
    expect(exact.shrink).toBe(219);

    const withinSlop = decideRetainedRows(100, 400, [
      row(1, 40, 100 + PIN_SLOP_PX),
    ]);
    expect(withinSlop.collapse).toEqual([1]);
    expect(withinSlop.shrink).toBeCloseTo(101);

    const overSlop = decideRetainedRows(100, 400, [row(1, 40, 101.2)]);
    expect(overSlop.retain).toEqual([1]);
    expect(overSlop.collapse).toEqual([]);
  });

  it("collapses rows below the anchor even when scrollTop is 0", () => {
    const decision = decideRetainedRows(0, 100, [
      row(4, 240, 180),
      row(2, 40, 200),
    ]);
    expect(decision.collapse).toEqual([4]);
    expect(decision.retain).toEqual([2]);
  });

  it("collapses a lower above-row when an upper one does not fit", () => {
    // scrollTop 50 can take the 30px row and not the 80px row.
    const decision = decideRetainedRows(50, 500, [
      row(9, 200, 30),
      row(3, 20, 80),
    ]);
    expect(decision.retain).toEqual([3]);
    expect(decision.collapse).toEqual([9]);
    expect(decision.shrink).toBe(30);
  });

  it("folds from the top across a gap, including a row only partly above the anchor", () => {
    const decision = decideRetainedRows(400, 800, [
      row(1, 10, 150),
      row(5, 420, 150),
      row(8, 900, 400),
    ]);
    expect(decision.collapse).toEqual([8, 1, 5]);
    expect(decision.retain).toEqual([]);
    expect(decision.shrink).toBe(300);
  });

  it("retains every above row when the total shrink exceeds scrollTop", () => {
    const decision = decideRetainedRows(200, 900, [
      row(1, 10, 150),
      row(2, 200, 150),
    ]);
    expect(decision.collapse).toEqual([1]);
    expect(decision.retain).toEqual([2]);
    expect(decision.shrink).toBe(150);
  });

  it("treats a non-positive scrollTop as no room and an unknown shrink as keep", () => {
    const decision = decideRetainedRows(-20, 300, [
      row(1, 10, 0),
      row(2, 40, Number.POSITIVE_INFINITY),
      row(3, 80, Number.NaN),
    ]);
    expect(decision.collapse).toEqual([1]);
    expect(decision.retain).toEqual([2, 3]);
  });

  it("orders by document start, not hit index", () => {
    const decision = decideRetainedRows(0, 500, [
      row(20, 40, 80),
      row(2, 10, 80),
    ]);
    expect(decision.retain).toEqual([2, 20]);
  });
});

describe("pointerRestBlocked", () => {
  it("blocks while scrolling and while the pointer is outside", () => {
    expect(pointerRestBlocked(true, true)).toBe(true);
    expect(pointerRestBlocked(false, false)).toBe(true);
    expect(pointerRestBlocked(true, false)).toBe(true);
    expect(pointerRestBlocked(false, true)).toBe(false);
  });
});

function box(
  index: number,
  top: number,
  height: number,
): VisibleHitBox {
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
    expect(pickReleaseAnchor({ index: 9, key: hitExpandKey(9) }, [], 0, 600)).toBeNull();
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
