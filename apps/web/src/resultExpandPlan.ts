/** Anchor movement still treated as steady, in CSS pixels. */
export const PIN_SLOP_PX = 1;

/** Pointer hover must not open or close while scrolling or outside the list. */
export function pointerRestBlocked(
  scrolling: boolean,
  inside: boolean,
): boolean {
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

/** Scroll offset and document start of the row that was settled before a switch. */
export type ScrollHome = {
  index: number;
  scrollTop: number;
  /** Row switched to when this offset was saved. */
  away: number | null;
  /** Document start of `index` at save time, before that switch resized rows. */
  start: number;
};

/**
 * How much to add to `scrollBefore` so `home.index` returns to the screen
 * position it had when `home` was saved.
 *
 * `home.away` is the row we switched to when that offset was saved. Coming
 * back means leaving that row for `home.index` — a later, unrelated visit
 * does not qualify, or a stale index would yank scroll. The clip may already
 * have finished. A real wheel leaves the pin in charge.
 *
 * `currentStart` is the row's document start now. A measurement that lands
 * while the clip runs (estimated rows above the fold becoming real heights)
 * moves that start, and the virtualizer already adds the same amount to
 * `scrollTop`. Restoring the raw saved offset would undo that compensation
 * and slide the row by the whole growth. The target keeps the growth:
 * `home.scrollTop + (currentStart - home.start)`.
 */
export function scrollRestoreDelta(
  home: ScrollHome | null,
  anchor: number | null,
  scrollBefore: number,
  leavingIndex: number | null,
  currentStart: number | null,
  userScrolling: boolean,
): number | null {
  if (
    userScrolling ||
    home === null ||
    anchor === null ||
    leavingIndex === null ||
    currentStart === null ||
    home.away === null ||
    leavingIndex !== home.away ||
    anchor !== home.index ||
    !Number.isFinite(home.scrollTop) ||
    !Number.isFinite(home.start) ||
    !Number.isFinite(scrollBefore) ||
    !Number.isFinite(currentStart)
  ) {
    return null;
  }
  return home.scrollTop + (currentStart - home.start) - scrollBefore;
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
