/** Anchor movement still treated as steady, in CSS pixels. */
export const PIN_SLOP_PX = 1;

export type OpenRowLayout = {
  /** Hit index. Not a visual order. */
  index: number;
  /** Document offset of the row top. Smaller is higher on the page. */
  start: number;
  /**
   * Pixels the anchor moves up if this row collapses.
   * Non-finite means the shrink is unknown and the row must stay open.
   */
  shrink: number;
};

export type RetainDecision = {
  /** Rows that stay expanded so the anchor does not jump. */
  retain: number[];
  /** Rows that can collapse. Includes rows below the anchor. */
  collapse: number[];
  /** Upward shift, in px, from the collapsed rows that sit above the anchor. */
  shrink: number;
};

function finiteShrink(shrink: number): number {
  if (!Number.isFinite(shrink)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, shrink);
}

/**
 * Decide which open rows may collapse without moving `anchorStart`.
 *
 * A row below the anchor only grows or shrinks underneath it, so it always
 * collapses. A row above the anchor moves the anchor up by `shrink`. That
 * shift is cancelled by decreasing `scrollTop`, which cannot go below 0.
 * Rows are folded from the top while the leftover shift stays within
 * `slopPx`. Anything that would leave a larger jump stays open.
 */
export function decideRetainedRows(
  scrollTop: number,
  anchorStart: number,
  rows: readonly OpenRowLayout[],
  slopPx = PIN_SLOP_PX,
): RetainDecision {
  const budget = Math.max(0, scrollTop) + Math.max(0, slopPx);
  const above: OpenRowLayout[] = [];
  const collapse: number[] = [];
  for (const row of rows) {
    if (row.start >= anchorStart) {
      collapse.push(row.index);
      continue;
    }
    above.push(row);
  }
  above.sort((a, b) => a.start - b.start || a.index - b.index);
  const retain: number[] = [];
  let used = 0;
  for (const row of above) {
    const shrink = finiteShrink(row.shrink);
    if (used + shrink <= budget) {
      collapse.push(row.index);
      used += shrink;
    } else {
      retain.push(row.index);
    }
  }
  return { retain, collapse, shrink: used };
}

/** Pointer hover must not open or close while scrolling or outside the list. */
export function pointerRestBlocked(scrolling: boolean, inside: boolean): boolean {
  return scrolling || !inside;
}
