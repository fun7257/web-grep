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

/** Stable identity of a hit across sort and fold. The original index does not change. */
export function hitExpandKey(index: number): string {
  return `hit:${index}`;
}

export type VisibleHitBox = {
  index: number;
  key: string;
  top: number;
  bottom: number;
};

/**
 * Anchor for a collapse that happens while the pointer is not on a hit
 * (fold, sort, or leaving the list).
 *
 * Prefer the last pointer hit if that key is still in the viewport. Otherwise
 * the first visible hit. A key that is not in `visible` is skipped — after
 * sort/fold the caller looks the chosen key up again and does not pin if the
 * new row set dropped it.
 */
export function pickReleaseAnchor(
  lastPointer: { index: number; key: string } | null,
  visible: readonly VisibleHitBox[],
  viewTop: number,
  viewBottom: number,
): { index: number; key: string } | null {
  const inView = (row: VisibleHitBox): boolean =>
    row.bottom > viewTop && row.top < viewBottom;
  if (lastPointer !== null) {
    const row = visible.find((item) => item.key === lastPointer.key);
    if (row !== undefined && inView(row)) {
      return { index: row.index, key: row.key };
    }
  }
  let first: VisibleHitBox | null = null;
  for (const row of visible) {
    if (!inView(row)) {
      continue;
    }
    if (
      first === null ||
      row.top < first.top ||
      (row.top === first.top && row.index < first.index)
    ) {
      first = row;
    }
  }
  if (first === null) {
    return null;
  }
  return { index: first.index, key: first.key };
}

/**
 * How much to add to `scrollTop` so an anchor that moved by `shift`
 * (`newTop - oldTop`) returns to its previous viewport top.
 *
 * The result stays inside `[0, maxScroll]`. Zero means the list cannot absorb
 * any of the shift (already at the limit, or the leftover is within `slopPx`).
 *
 * Product ruling: fold, sort, and pointer-leave fire while the pointer is on
 * a button or outside the list, so "do not jump" does not apply to a row the
 * pointer is resting on. When this returns a non-zero value the caller must
 * apply it. When it returns 0 — or when the clamped value is only part of
 * `shift` — the caller still collapses immediately. Do not pad the list and
 * do not delay the collapse; the unabsorbed movement is expected. The same
 * rule covers a baseline fold of another group, which already moves rows when
 * `scrollTop` is 0.
 */
export function absorbAnchorShift(
  scrollTop: number,
  shift: number,
  maxScroll: number,
  slopPx = PIN_SLOP_PX,
): number {
  if (!Number.isFinite(shift) || Math.abs(shift) <= Math.max(0, slopPx)) {
    return 0;
  }
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const max = Number.isFinite(maxScroll) ? Math.max(top, maxScroll) : top;
  const clamped = Math.min(max, Math.max(0, top + shift));
  const applied = clamped - top;
  if (Math.abs(applied) <= Math.max(0, slopPx)) {
    return 0;
  }
  return applied;
}
