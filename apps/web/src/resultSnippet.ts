import type { HlSpan } from "./highlight.ts";

/** ~1 visual line in the hits pane (12.5px mono, ~560–720px wide). */
export const RESULT_SNIPPET_LINE_CHARS = 75;
/** Extra wrapped lines kept on each side of a single match cluster. */
export const RESULT_SNIPPET_CONTEXT_LINES = 2;
export const RESULT_SNIPPET_PREFIX_MAX =
  RESULT_SNIPPET_LINE_CHARS * RESULT_SNIPPET_CONTEXT_LINES;
/** 2 lines before + 1 line for the match + 2 lines after. */
export const RESULT_SNIPPET_BUDGET =
  RESULT_SNIPPET_PREFIX_MAX * 2 + RESULT_SNIPPET_LINE_CHARS;
export const RESULT_SNIPPET_MIN_LINES = 5;
export const RESULT_SNIPPET_MAX_LINES = 10;
export const RESULT_SNIPPET_MIN_BUDGET =
  RESULT_SNIPPET_MIN_LINES * RESULT_SNIPPET_LINE_CHARS;
export const RESULT_SNIPPET_MAX_BUDGET =
  RESULT_SNIPPET_MAX_LINES * RESULT_SNIPPET_LINE_CHARS;
/** Merge highlights into one window when they are at most a line apart. */
export const RESULT_SNIPPET_JOIN_GAP = RESULT_SNIPPET_LINE_CHARS;
/** Extra highlight clusters beyond this are dropped instead of painting the whole line. */
export const RESULT_SNIPPET_MAX_CLUSTERS = 4;

export type SnippetClip = { start: number; end: number };

function clampSpan(
  span: { start: number; end: number },
  length: number,
): { start: number; end: number } | null {
  const start = Math.max(0, Math.min(span.start, length));
  const end = Math.max(start, Math.min(span.end, length));
  if (end <= start) {
    return null;
  }
  return { start, end };
}

function clusterHits(hits: SnippetClip[], gap: number): SnippetClip[] {
  const clusters: SnippetClip[] = [];
  for (const hit of hits) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && hit.start - last.end <= gap) {
      last.end = Math.max(last.end, hit.end);
    } else {
      clusters.push({ start: hit.start, end: hit.end });
    }
  }
  return clusters;
}

function windowAround(
  text: string,
  lo: number,
  hi: number,
  budget: number,
  maxSide: number,
): SnippetClip {
  const n = text.length;
  if (hi - lo > budget) {
    return { start: lo, end: lo + budget };
  }
  const side = Math.min(
    maxSide,
    Math.max(0, Math.floor((budget - (hi - lo)) / 2)),
  );
  let start = Math.max(0, lo - side);
  while (start < lo && /\s/.test(text[start] ?? "")) {
    start += 1;
  }
  return { start, end: Math.min(n, hi + side) };
}

function mergeClips(clips: SnippetClip[]): SnippetClip[] {
  const out: SnippetClip[] = [];
  for (const clip of clips) {
    const last = out[out.length - 1];
    if (last !== undefined && clip.start <= last.end + 1) {
      last.end = Math.max(last.end, clip.end);
    } else {
      out.push({ start: clip.start, end: clip.end });
    }
  }
  return out;
}

/** Keep both edges off a dangling surrogate so a later slice cannot split a pair. */
function snapClip(text: string, clip: SnippetClip): SnippetClip {
  const n = text.length;
  let start = Math.max(0, Math.min(clip.start, n));
  let end = Math.max(start, Math.min(clip.end, n));
  if (start > 0) {
    const unit = text.charCodeAt(start);
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      start -= 1;
    }
  }
  if (end > start && end < n) {
    const unit = text.charCodeAt(end - 1);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      end -= 1;
    }
  }
  if (end < start) {
    end = start;
  }
  return { start, end };
}

function finishClips(text: string, clips: SnippetClip[]): SnippetClip[] {
  return mergeClips(clips.map((clip) => snapClip(text, clip)));
}

export function clipResultSnippets(
  text: string,
  spans: Array<{ start: number; end: number }>,
  budget = RESULT_SNIPPET_BUDGET,
): SnippetClip[] {
  const n = text.length;
  const hits: SnippetClip[] = [];
  for (const span of spans) {
    const clamped = clampSpan(span, n);
    if (clamped !== null) {
      hits.push(clamped);
    }
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  if (hits.length === 0) {
    return finishClips(text, [{ start: 0, end: Math.min(n, budget) }]);
  }

  const clusters = clusterHits(hits, RESULT_SNIPPET_JOIN_GAP).slice(
    0,
    RESULT_SNIPPET_MAX_CLUSTERS,
  );
  const first = clusters[0]!;
  const last = clusters[clusters.length - 1]!;
  let elastic = budget;
  if (budget >= RESULT_SNIPPET_MIN_BUDGET) {
    elastic = Math.min(
      RESULT_SNIPPET_MAX_BUDGET,
      RESULT_SNIPPET_MIN_BUDGET +
        Math.max(0, clusters.length - 1) * 2 * RESULT_SNIPPET_LINE_CHARS,
    );
  }
  if (clusters.length === 1 || last.end - first.start <= elastic) {
    return finishClips(text, [
      windowAround(
        text,
        first.start,
        last.end,
        elastic,
        RESULT_SNIPPET_PREFIX_MAX,
      ),
    ]);
  }

  const per = Math.max(
    RESULT_SNIPPET_LINE_CHARS,
    Math.floor(elastic / clusters.length),
  );
  return finishClips(
    text,
    clusters.map((cluster) =>
      windowAround(
        text,
        cluster.start,
        cluster.end,
        per,
        RESULT_SNIPPET_LINE_CHARS,
      ),
    ),
  );
}

/** ~half a results pane: ~30 wrapped lines at ~100 columns. */
export const LOG_LINE_CHAR_BUDGET = 3000;

export function clipLineEnd(
  text: string,
  budget = LOG_LINE_CHAR_BUDGET,
): SnippetClip {
  return snapClip(text, {
    start: 0,
    end: Math.min(text.length, Math.max(0, budget)),
  });
}

/**
 * Clip one result-list row.
 * Lines within the list budget stay whole. Longer lines reuse the snippet
 * windows so the first hit stays near the front of the row: a prefix cut
 * hides it, and the row's line clamp never reaches a marker parked at the
 * end of 3000 characters. With no hit, the prefix cut remains.
 */
export function clipLogLine(
  text: string,
  spans: Array<{ start: number; end: number }> = [],
  budget = LOG_LINE_CHAR_BUDGET,
): SnippetClip[] {
  if (text.length <= budget) {
    return [{ start: 0, end: text.length }];
  }
  const hits: SnippetClip[] = [];
  for (const span of spans) {
    const clamped = clampSpan(span, text.length);
    if (clamped !== null) {
      hits.push(clamped);
    }
  }
  if (hits.length === 0) {
    return [clipLineEnd(text, budget)];
  }
  return clipResultSnippets(text, hits);
}

/** Expanded row shows at most this many UTF-16 code units. */
export const EXPAND_CAP = 1600;
/** Code units kept from the start of an over-cap line. */
export const EXPAND_HEAD = 320;
/**
 * Code units kept before the first hit inside the match window.
 * Matches the row-open design (head + this lead, window budget = cap − head).
 */
export const EXPAND_HIT_LEAD = 220;

export type ExpandPiece =
  | { kind: "text"; start: number; end: number }
  | { kind: "skip"; omitted: number };

function firstHit(
  text: string,
  spans: Array<{ start: number; end: number }>,
): SnippetClip | null {
  let best: SnippetClip | null = null;
  for (const span of spans) {
    const clamped = clampSpan(span, text.length);
    if (clamped === null) {
      continue;
    }
    if (
      best === null ||
      clamped.start < best.start ||
      (clamped.start === best.start && clamped.end < best.end)
    ) {
      best = clamped;
    }
  }
  return best;
}

function mergeTouching(clips: SnippetClip[]): SnippetClip[] {
  const out: SnippetClip[] = [];
  for (const clip of clips) {
    if (clip.end <= clip.start) {
      continue;
    }
    const last = out[out.length - 1];
    if (last !== undefined && clip.start <= last.end) {
      last.end = Math.max(last.end, clip.end);
    } else {
      out.push({ start: clip.start, end: clip.end });
    }
  }
  return out;
}

function normalizeRanges(text: string, clips: SnippetClip[]): SnippetClip[] {
  const snapped = clips
    .map((clip) => snapClip(text, clip))
    .filter((clip) => clip.end > clip.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return mergeTouching(snapped);
}

function pieceBudget(clips: SnippetClip[]): number {
  let total = 0;
  for (const clip of clips) {
    total += clip.end - clip.start;
  }
  return total;
}

/** Drop excess code units from the tail, then the head, without uncovering `hitStart`. */
function shrinkToCap(
  text: string,
  clips: SnippetClip[],
  cap: number,
  hitStart: number | null,
): SnippetClip[] {
  const out = clips.map((clip) => ({ start: clip.start, end: clip.end }));
  let guard = 0;
  while (pieceBudget(out) > cap && out.length > 0 && guard < 8) {
    guard += 1;
    const over = pieceBudget(out) - cap;
    const last = out[out.length - 1];
    if (last === undefined) {
      break;
    }
    const hitInLast =
      hitStart !== null && hitStart >= last.start && hitStart < last.end;
    const minEnd = hitInLast ? hitStart + 1 : last.start;
    const snapped = snapClip(text, {
      start: last.start,
      end: Math.max(minEnd, last.end - over),
    });
    if (snapped.end < last.end) {
      last.end = snapped.end;
      if (last.end <= last.start) {
        out.pop();
      }
      continue;
    }
    if (out.length < 2) {
      break;
    }
    const head = out[0];
    if (head === undefined) {
      break;
    }
    const headSnap = snapClip(text, {
      start: head.start,
      end: Math.max(head.start, head.end - over),
    });
    if (headSnap.end >= head.end) {
      break;
    }
    head.end = headSnap.end;
    if (head.end <= head.start) {
      out.shift();
    }
  }
  return out.filter((clip) => clip.end > clip.start);
}

function toPieces(length: number, clips: SnippetClip[]): ExpandPiece[] {
  const out: ExpandPiece[] = [];
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start > cursor) {
      out.push({ kind: "skip", omitted: clip.start - cursor });
    }
    if (clip.end > clip.start) {
      out.push({ kind: "text", start: clip.start, end: clip.end });
    }
    cursor = clip.end;
  }
  if (cursor < length) {
    out.push({ kind: "skip", omitted: length - cursor });
  }
  return out;
}

/**
 * Visible slices for an expanded result row.
 * Lines within `cap` stay whole. Longer lines keep `head` code units from
 * the start plus a window around the first in-range hit, totaling at most
 * `cap`. Cuts snap off a dangling surrogate. Empty or out-of-range spans
 * fall back to a prefix of `cap`.
 */
export function expandLogLine(
  text: string,
  spans: Array<{ start: number; end: number }> = [],
  cap = EXPAND_CAP,
  head = EXPAND_HEAD,
): ExpandPiece[] {
  const length = text.length;
  if (length === 0) {
    return [];
  }
  const limit = Math.max(0, cap);
  if (limit === 0) {
    return [{ kind: "skip", omitted: length }];
  }
  if (length <= limit) {
    return [{ kind: "text", start: 0, end: length }];
  }

  const headLen = Math.max(0, Math.min(Math.floor(head), limit));
  const hit = firstHit(text, spans);
  const raw: SnippetClip[] = [];
  if (hit === null || hit.start < headLen) {
    raw.push({ start: 0, end: Math.min(length, limit) });
  } else {
    const windowBudget = limit - headLen;
    let ws = Math.max(headLen, hit.start - EXPAND_HIT_LEAD);
    let we = Math.min(length, ws + Math.max(0, windowBudget));
    if (hit.start >= we) {
      const fit = Math.max(1, windowBudget);
      we = Math.min(length, hit.start + 1);
      ws = Math.max(0, we - fit);
    }
    const headEnd = Math.min(headLen, ws);
    if (headEnd > 0) {
      raw.push({ start: 0, end: headEnd });
    }
    if (we > ws) {
      raw.push({ start: ws, end: we });
    }
  }

  let clips = normalizeRanges(text, raw);
  if (
    hit !== null &&
    !clips.some((clip) => clip.start <= hit.start && hit.start < clip.end)
  ) {
    clips = normalizeRanges(text, [
      ...clips,
      { start: hit.start, end: Math.min(length, hit.start + 1) },
    ]);
  }
  clips = shrinkToCap(text, clips, limit, hit?.start ?? null);
  return toPieces(length, clips);
}

export function clipResultSnippet(
  text: string,
  spans: Array<{ start: number; end: number }>,
  budget = RESULT_SNIPPET_BUDGET,
): SnippetClip {
  return (
    clipResultSnippets(text, spans, budget)[0] ?? {
      start: 0,
      end: Math.min(text.length, budget),
    }
  );
}

export function shiftSpans(
  spans: HlSpan[],
  start: number,
  end: number,
): HlSpan[] {
  const out: HlSpan[] = [];
  for (const span of spans) {
    const lo = Math.max(span.start, start);
    const hi = Math.min(span.end, end);
    if (hi > lo) {
      out.push({ start: lo - start, end: hi - start, tone: span.tone });
    }
  }
  return out;
}
