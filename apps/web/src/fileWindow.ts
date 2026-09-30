export type WindowLine = { n: number; text: string };

export function mergeLines(
  current: WindowLine[],
  incoming: WindowLine[],
): WindowLine[] {
  if (incoming.length === 0) {
    return current;
  }
  const byN = new Map<number, WindowLine>();
  for (const line of current) {
    byN.set(line.n, line);
  }
  for (const line of incoming) {
    byN.set(line.n, line);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

export type LineAnchor = {
  /** First loaded line before this upward page. */
  prevFirst: number;
  /** Line that should stay at the same viewport offset. */
  line: number;
  /** `lineStart - scrollTop` when the anchor was captured. */
  offset: number;
};

/** Lines above `firstLine` to request, or null when the window already starts at line 1. */
export function upwardRange(
  firstLine: number,
  chunk: number,
): { from: number; count: number } | null {
  if (!Number.isInteger(firstLine) || firstLine <= 1) {
    return null;
  }
  if (!Number.isFinite(chunk)) {
    return null;
  }
  const size = Math.max(1, Math.floor(chunk));
  const from = Math.max(1, firstLine - size);
  if (from >= firstLine) {
    return null;
  }
  return { from, count: firstLine - from };
}

/**
 * First loaded line that intersects the viewport, in virtualizer coordinates.
 * `offset` is that line's top relative to the scroller (`start - scrollTop`).
 */
export function captureLineAnchor(
  lines: readonly WindowLine[],
  items: readonly { index: number; start: number; end: number }[],
  scrollTop: number,
): LineAnchor | null {
  const prevFirst = lines[0]?.n;
  if (prevFirst === undefined || !Number.isFinite(scrollTop)) {
    return null;
  }
  const anchor = items.find((item) => item.end > scrollTop + 0.5) ?? items[0];
  if (anchor === undefined) {
    return null;
  }
  const line = lines[anchor.index]?.n;
  if (line === undefined) {
    return null;
  }
  return { prevFirst, line, offset: anchor.start - scrollTop };
}

/** Scroll offset that keeps a line at the same viewport offset after a prepend. */
export function scrollTopToHoldLine(lineStart: number, offset: number): number {
  if (!Number.isFinite(lineStart) || !Number.isFinite(offset)) {
    return 0;
  }
  const next = lineStart - offset;
  if (!Number.isFinite(next) || next <= 0) {
    return 0;
  }
  return next;
}

/** Fallback when measured positions are not available yet: one estimated row per prepended line. */
export function scrollTopAfterPrepend(
  prevScrollTop: number,
  addedRows: number,
  rowHeight: number,
): number {
  const base =
    Number.isFinite(prevScrollTop) && prevScrollTop > 0 ? prevScrollTop : 0;
  if (!Number.isInteger(addedRows) || addedRows <= 0) {
    return base;
  }
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return base;
  }
  return base + addedRows * rowHeight;
}

/**
 * Prefer the anchor line's measured start. A zero start at a positive index
 * means the measurement cache has not caught up with the prepend yet.
 */
export function anchoredScrollTop(input: {
  prevFirst: number;
  nextFirst: number;
  anchorIndex: number;
  anchorStart: number | null;
  anchorOffset: number;
  prevScrollTop: number;
  rowHeight: number;
}): number {
  const added = input.prevFirst - input.nextFirst;
  const measured =
    input.anchorStart !== null &&
    Number.isFinite(input.anchorStart) &&
    !(input.anchorStart === 0 && input.anchorIndex > 0);
  if (measured && input.anchorStart !== null) {
    return scrollTopToHoldLine(input.anchorStart, input.anchorOffset);
  }
  return scrollTopAfterPrepend(input.prevScrollTop, added, input.rowHeight);
}

export function rangeForLine(
  line: number,
  chunk: number,
  maxCount: number = chunk,
): { from: number; count: number } {
  const cap = Math.max(1, Math.floor(maxCount));
  const size = Math.min(Math.max(1, Math.floor(chunk)), cap);
  if (!Number.isInteger(line) || line <= 1) {
    return { from: 1, count: size };
  }
  const leadWanted = Math.min(size, line - 1);
  let count = leadWanted + size;
  if (count > cap) {
    const lead = Math.min(leadWanted, cap - 1);
    return { from: line - lead, count: cap };
  }
  return { from: line - leadWanted, count };
}

export function parseGotoLine(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }
  return n;
}

export function pickGotoLine(
  lines: WindowLine[],
  requested: number,
): number | null {
  if (lines.length === 0) {
    return null;
  }
  const exact = lines.find((line) => line.n === requested);
  if (exact !== undefined) {
    return exact.n;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (last !== undefined && requested > last.n) {
    return last.n;
  }
  if (first !== undefined && requested < first.n) {
    return first.n;
  }
  let best = first ?? last;
  if (best === undefined) {
    return null;
  }
  for (const line of lines) {
    if (Math.abs(line.n - requested) < Math.abs(best.n - requested)) {
      best = line;
    }
  }
  return best.n;
}
