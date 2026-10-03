import { absorbAnchorShift, PIN_SLOP_PX } from "./resultExpandPlan.ts";
import { clipLogLine, expandLogLine } from "./resultSnippet.ts";

/** Expand timing from the v3 prototype. */
export const EXPAND_MS = 240;
/** Collapse is shorter and snappier than expand. */
export const COLLAPSE_MS = 170;
export const EXPAND_EASE = "cubic-bezier(.22,1,.36,1)";
export const COLLAPSE_EASE = "cubic-bezier(.4,0,.2,1)";
/** A second switch this soon snaps instead of stacking animations. */
export const SWITCH_GAP_MS = 120;
export const BG_EXTRA_MS = 60;
export const TEXT_FADE_FROM = 0.35;
export const TEXT_FADE_SCALE = 0.7;
export const NOTE_DELAY_SCALE = 0.5;
export const NOTE_DURATION_SCALE = 0.45;
export const MARK_DELAY_SCALE = 0.5;
export const MARK_DURATION_SCALE = 0.5;
/** Collapsed clip and expanded head disagree above the 3000-character budget. */
export const CROSSFADE_MS = 80;

export function shouldAnimateMotion(input: {
  reducedMotion: boolean;
  scrolling: boolean;
  keyRepeat: boolean;
  sinceLastMs: number | null;
  waapi: boolean;
}): boolean {
  if (
    !input.waapi ||
    input.reducedMotion ||
    input.scrolling ||
    input.keyRepeat
  ) {
    return false;
  }
  if (input.sinceLastMs !== null && input.sinceLastMs < SWITCH_GAP_MS) {
    return false;
  }
  return true;
}

/**
 * Scrolling still blocks a fresh expand. If a clip is already running, the
 * switch has to retarget it from the current visible height. Clearing the
 * clip drops the row onto the final border in one frame.
 * Key repeat, reduced motion, and a gap under {@link SWITCH_GAP_MS} still snap.
 */
export function shouldRetargetInFlight(input: {
  play: boolean;
  scrolling: boolean;
  reducedMotion: boolean;
  keyRepeat: boolean;
  sinceLastMs: number | null;
  waapi: boolean;
  inFlight: boolean;
}): boolean {
  if (input.play) {
    return true;
  }
  if (
    !input.inFlight ||
    !input.waapi ||
    input.reducedMotion ||
    input.keyRepeat ||
    !input.scrolling
  ) {
    return false;
  }
  if (input.sinceLastMs !== null && input.sinceLastMs < SWITCH_GAP_MS) {
    return false;
  }
  return true;
}

/**
 * Border the new clip is relative to.
 *
 * Mid-flight, `getBoundingClientRect` still reports the previous round's
 * border when `Element.animate` runs. The inset is `border - visual`, so
 * that stale border is only a few pixels and the next frame (border flipped)
 * jumps by the whole delta. A remembered final border is used only while the
 * live box has not left the previous one. After it has moved, the live box
 * wins, including subpixels.
 */
export function pickLayoutHeight(
  live: number,
  previous: number,
  target: number | null | undefined,
): number {
  if (
    target === undefined ||
    target === null ||
    !Number.isFinite(target) ||
    !(target > 0)
  ) {
    return live;
  }
  if (Math.abs(live - target) <= 1) {
    return live;
  }
  if (Math.abs(live - previous) <= 1) {
    return target;
  }
  return live;
}

/**
 * Bottom inset of `inset()`, in px. Negative shows overflow.
 *
 * CSS shorthand, same as margin: 1 value is all sides, 2 is top/bottom then
 * left/right, 3 is top, left/right, bottom, 4 is top, right, bottom, left.
 * Anything after `round` is a corner radius and is ignored. Chromium's
 * computed style drops repeated edges, so a four-value animation often comes
 * back as three values (`inset(0px 0px -418px)`).
 */
export function parseClipBottom(clipPath: string): number | null {
  const open = /inset\(/i.exec(clipPath);
  if (open === null) {
    return null;
  }
  let rest = clipPath.slice(open.index + open[0].length);
  const roundAt = /(?:^|\s)round\b/i.exec(rest);
  if (roundAt !== null) {
    rest = rest.slice(0, roundAt.index);
  }
  const close = rest.indexOf(")");
  if (close !== -1) {
    rest = rest.slice(0, close);
  }
  const nums = [...rest.matchAll(/(-?(?:\d+\.?\d*|\.\d+))px/gi)].map((match) =>
    Number(match[1]),
  );
  if (nums.length < 1 || nums.length > 4) {
    return null;
  }
  if (nums.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const bottom = nums.length <= 2 ? nums[0] : nums[2];
  return bottom === undefined ? null : bottom;
}

/** Easing progress at linear time `t` in 0..1. Named curves and `cubic-bezier()`. */
export function sampleEasing(easing: string, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (easing === "linear") {
    return clamped;
  }
  if (easing === "ease-out") {
    return sampleCubic(0, 0, 0.58, 1, clamped);
  }
  if (easing === "ease-in") {
    return sampleCubic(0.42, 0, 1, 1, clamped);
  }
  if (easing === "ease-in-out") {
    return sampleCubic(0.42, 0, 0.58, 1, clamped);
  }
  if (easing === "ease") {
    return sampleCubic(0.25, 0.1, 0.25, 1, clamped);
  }
  const match =
    /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(
      easing,
    );
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return clamped;
  }
  return sampleCubic(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    clamped,
  );
}

function sampleCubic(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (sampleX(mid) < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return sampleY((lo + hi) / 2);
}

/** Visible height. A positive bottom inset hides pixels; a negative one reveals overflow. */
export function visualHeight(
  borderHeight: number,
  clipBottom: number | null,
): number {
  if (clipBottom === null || !Number.isFinite(clipBottom)) {
    return borderHeight;
  }
  return borderHeight - clipBottom;
}

export function formatPx(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}px`;
}

/**
 * Clip that takes a box of `layoutHeight` from a current visible height of
 * `visualFrom` to the full box. The same inset works for grow (positive,
 * hiding the new tail) and shrink (negative, showing overflow).
 */
export function clipRange(
  layoutHeight: number,
  visualFrom: number,
): { from: string; to: string } | null {
  const inset = layoutHeight - visualFrom;
  if (!Number.isFinite(inset) || Math.abs(inset) < 0.5) {
    return null;
  }
  return {
    from: `inset(0px 0px ${formatPx(inset)} 0px)`,
    to: "inset(0px 0px 0px 0px)",
  };
}

export type HeightCause = {
  /** Document offset of the row top before this switch. */
  start: number;
  /** `newLayoutHeight - oldLayoutHeight`. Positive when the row grew. */
  layoutDelta: number;
  /**
   * `newLayoutHeight - oldVisualHeight`. Equals `layoutDelta` when the row
   * was settled. Mid-flight, the clip follows this and the layout shift
   * follows `layoutDelta`.
   */
  visualDelta?: number;
  opening: boolean;
};

export type EaseClock = {
  duration: number;
  easing: string;
};

export function clockFor(opening: boolean): EaseClock {
  return opening
    ? { duration: EXPAND_MS, easing: EXPAND_EASE }
    : { duration: COLLAPSE_MS, easing: COLLAPSE_EASE };
}

/**
 * Clock for the part of `visualDy` that no height change above this row
 * explains (scroll moving the row itself, or a subpixel leftover).
 * A changing row uses its own clip clock. Any other row uses the nearest
 * cause above it, so it stays glued to that edge.
 */
export function residualClock(
  own: "open" | "close" | "none",
  causes: readonly HeightCause[],
  rowStart: number,
): EaseClock {
  if (own === "open" || own === "close") {
    return clockFor(own === "open");
  }
  let nearest: HeightCause | undefined;
  let topmost: HeightCause | undefined;
  for (const cause of causes) {
    if (topmost === undefined || cause.start < topmost.start) {
      topmost = cause;
    }
    if (cause.start < rowStart - 0.5) {
      if (nearest === undefined || cause.start > nearest.start) {
        nearest = cause;
      }
    }
  }
  const follow = nearest ?? topmost;
  if (follow === undefined) {
    return clockFor(false);
  }
  return clockFor(follow.opening);
}

export type TranslatePiece = {
  fromY: number;
  duration: number;
  easing: string;
};

/**
 * Viewport correction for one row, split per height change so a 170ms collapse
 * and a 240ms expand can run together.
 *
 * `visualDy` is `beforeVisualTop - afterTop` (the translate that puts the row
 * back where it was). Each cause contributes the part of that shift that
 * belongs to its own easing. A leftover (mid-flight motion, rounding) is one
 * extra piece on the longest timing so the first frame still matches the
 * measured pixels.
 */
export function planTranslatePieces(
  visualDy: number,
  rowStart: number,
  anchorStart: number,
  causes: readonly HeightCause[],
  scrollDelta: number,
  residualTiming?: EaseClock,
): TranslatePiece[] {
  const aboveAnchor = causes.filter((cause) => cause.start < anchorStart - 0.5);
  const rawAnchor = aboveAnchor.reduce(
    (sum, cause) => sum + cause.layoutDelta,
    0,
  );
  const scale = Math.abs(rawAnchor) > 0.5 ? scrollDelta / rawAnchor : 0;
  const pieces: TranslatePiece[] = [];
  let explained = 0;
  for (const cause of causes) {
    const shift = cause.visualDelta ?? cause.layoutDelta;
    if (Math.abs(cause.layoutDelta) < 0.5 && Math.abs(shift) < 0.5) {
      continue;
    }
    if (cause.start >= rowStart - 0.5) {
      continue;
    }
    // Scroll is a one-shot of the layout shift. The animated part follows
    // the visible edge (`shift`), so a mid-flight clip and the rows under
    // it stay on one clock.
    const scrollPart =
      cause.start < anchorStart - 0.5 ? cause.layoutDelta * scale : 0;
    const fromY = -(shift - scrollPart);
    if (Math.abs(fromY) < 0.5) {
      continue;
    }
    explained += fromY;
    const clock = clockFor(cause.opening);
    pieces.push({
      fromY,
      duration: clock.duration,
      easing: clock.easing,
    });
  }
  const residual = visualDy - explained;
  if (Math.abs(residual) >= 0.5) {
    const longest = pieces.reduce<TranslatePiece | undefined>((best, piece) => {
      if (best === undefined || piece.duration > best.duration) {
        return piece;
      }
      return best;
    }, undefined);
    const clock = residualTiming ?? {
      duration: longest?.duration ?? (residual > 0 ? COLLAPSE_MS : EXPAND_MS),
      easing: longest?.easing ?? (residual > 0 ? COLLAPSE_EASE : EXPAND_EASE),
    };
    pieces.push({
      fromY: residual,
      duration: clock.duration,
      easing: clock.easing,
    });
  }
  return pieces;
}

export type CauseSeed = {
  hitIndex: number;
  docStart: number;
  layoutDelta: number;
};

/** How far `scrollTop` will move to keep the anchor, from layout deltas alone. */
export function predictScrollDelta(
  scrollTop: number,
  maxScroll: number,
  anchorStart: number | null,
  causes: readonly CauseSeed[],
): number {
  if (anchorStart === null) {
    return 0;
  }
  let raw = 0;
  for (const cause of causes) {
    if (cause.docStart < anchorStart - 0.5) {
      raw += cause.layoutDelta;
    }
  }
  return absorbAnchorShift(scrollTop, raw, maxScroll, PIN_SLOP_PX);
}

/**
 * Rows whose in-flight motion this switch must retarget.
 * One-shot `scrollTop` moves every visible row, including ones above the
 * height change. Leaving those to "ride the scroll" paints them inside the
 * collapse that is still showing its old height. Retarget all of them and
 * slide from the measured pixels. `unknownShift` is the same set: a closing
 * row with no measured height can move anything on screen.
 */
export function affectedKeys(
  rows: readonly { key: string; docStart: number; hitIndex: number | null }[],
  causes: readonly { hitIndex: number; docStart: number }[],
  unknownShift: boolean,
): Set<string> {
  const keys = new Set<string>();
  if (causes.length === 0 && !unknownShift) {
    return keys;
  }
  for (const row of rows) {
    keys.add(row.key);
  }
  return keys;
}

/**
 * Translate keyframes for one row.
 *
 * Each height change pushes the rows under it on that change's own clock
 * (expand 240ms, collapse 170ms). A closing row under an opening row therefore
 * follows the 240ms edge, while its own clip still shrinks on 170ms — the
 * next row picks up that 170ms piece. Putting the whole visual delta on the
 * collapse clock makes the opening clip run ahead and the two boxes overlap.
 *
 * What those pieces do not explain (scroll sliding this row, a mid-flight
 * leftover) uses `own`'s clip clock, or the cause this row is attached to.
 */
export function translatePlan(
  visualDy: number,
  rowStart: number,
  anchorStart: number,
  causes: readonly HeightCause[],
  scrollDelta: number,
  own: "open" | "close" | "none" = "none",
): TranslatePiece[] {
  return planTranslatePieces(
    visualDy,
    rowStart,
    anchorStart,
    causes,
    scrollDelta,
    residualClock(own, causes, rowStart),
  );
}

/**
 * First line of a >3000 character row: the collapsed window is not the
 * expanded head, so swapping content at the end of a collapse needs a fade.
 */
export function collapseHeadDiffers(
  text: string,
  anchors: readonly { start: number; end: number }[],
): boolean {
  if (text.length <= 3000) {
    return false;
  }
  const clip = clipLogLine(text, [...anchors])[0];
  const head = expandLogLine(text, [...anchors]).find(
    (piece) => piece.kind === "text",
  );
  if (clip === undefined || head === undefined) {
    return true;
  }
  const span = Math.min(48, clip.end - clip.start, head.end - head.start);
  if (span <= 0) {
    return true;
  }
  return (
    text.slice(clip.start, clip.start + span) !==
    text.slice(head.start, head.start + span)
  );
}

export type ComputedTimingLike = {
  progress?: number | null;
  currentTime?: number | null;
};

export type AnimLike = {
  cancel: () => void;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  playState?: string;
  currentTime?: number | null;
  effect?: { getComputedTiming?: () => ComputedTimingLike } | null;
};

export type AnimateFn = (
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => AnimLike;

type Tracked = {
  anim: AnimLike;
  kind: "move" | "clip" | "fade";
};

type Slot = {
  token: number;
  anims: Tracked[];
};

/**
 * Per-element generation. `stop` drops callbacks before `cancel`, then bumps
 * the token. A late finish/cancel from the previous animation sees a stale
 * token and does not clear the new animation's styles.
 */
export class MotionRegistry {
  /** Tests flip this to show an unguarded callback wipes the next animation. */
  guardToken = true;
  private slots = new WeakMap<HTMLElement, Slot>();
  private sweep: number | null = null;

  private slot(el: HTMLElement): Slot {
    let value = this.slots.get(el);
    if (value === undefined) {
      value = { token: 0, anims: [] };
      this.slots.set(el, value);
    }
    return value;
  }

  token(el: HTMLElement): number {
    return this.slot(el).token;
  }

  stop(el: HTMLElement): number {
    const slot = this.slot(el);
    for (const item of slot.anims) {
      item.anim.onfinish = null;
      item.anim.oncancel = null;
      item.anim.cancel();
    }
    slot.anims = [];
    slot.token += 1;
    return slot.token;
  }

  track(
    el: HTMLElement,
    token: number,
    anim: AnimLike,
    kind: Tracked["kind"],
    onSettled?: () => void,
  ): void {
    const slot = this.slot(el);
    if (this.guardToken && slot.token !== token) {
      anim.onfinish = null;
      anim.oncancel = null;
      anim.cancel();
      return;
    }
    slot.anims.push({ anim, kind });
    anim.oncancel = null;
    anim.onfinish = () => {
      anim.onfinish = null;
      if (this.guardToken && slot.token !== token) {
        return;
      }
      // Do not cancel here. onfinish is async and a cancel per animation
      // lays the document out once each. The sweep below clears finished
      // fills in one turn.
      onSettled?.();
    };
  }

  /**
   * Cancel fills that have reached the end state, after the longest
   * expand animation (background, duration + 60ms). One pass, not one
   * cancel per animation.
   */
  scheduleSweep(root: HTMLElement): void {
    if (this.sweep !== null) {
      window.clearTimeout(this.sweep);
    }
    this.sweep = window.setTimeout(() => {
      this.sweep = null;
      if (!root.isConnected) {
        return;
      }
      for (const rowEl of root.querySelectorAll<HTMLElement>(
        ".result-virtual-row",
      )) {
        this.dropFinished(rowEl);
      }
    }, EXPAND_MS + BG_EXTRA_MS + 40);
  }

  /** Drop finished clip/fade fills. Leave running translates alone. */
  dropFinished(el: HTMLElement): void {
    const slot = this.slot(el);
    const keep: Tracked[] = [];
    for (const item of slot.anims) {
      if (item.anim.playState === "finished") {
        item.anim.onfinish = null;
        item.anim.oncancel = null;
        item.anim.cancel();
        continue;
      }
      keep.push(item);
    }
    slot.anims = keep;
  }
}

export type MotionRow = {
  key: string;
  hitIndex: number | null;
  rowEl: HTMLElement;
  motionEl: HTMLElement;
  clipEl: HTMLElement | null;
  top: number;
  docStart: number;
  borderHeight: number;
  visualHeight: number;
};

type ClipTrack = {
  fromHeight: number;
  toHeight: number;
  duration: number;
  easing: string;
  anim: AnimLike;
};

/** Clip parameters for the element currently animating. Avoids computed style. */
const clipTracks = new WeakMap<HTMLElement, ClipTrack>();

export function rememberClip(
  el: HTMLElement,
  anim: AnimLike,
  fromHeight: number,
  toHeight: number,
  duration: number,
  easing: string,
): void {
  clipTracks.set(el, { fromHeight, toHeight, duration, easing, anim });
}

/**
 * Visible height from the clip we started, using the animation's eased
 * progress. `getComputedTiming().progress` is already eased. `currentTime`
 * is linear and still needs the curve. Returns null when this element has
 * no live clip, so the caller can fall back to the inset string.
 */
export function clipVisualHeight(el: HTMLElement): number | null {
  const track = clipTracks.get(el);
  if (track === undefined) {
    return null;
  }
  const progress = clipProgress(track);
  if (progress === null) {
    return null;
  }
  return track.fromHeight + (track.toHeight - track.fromHeight) * progress;
}

function clipProgress(track: ClipTrack): number | null {
  const { anim } = track;
  const state = anim.playState;
  if (state === "finished") {
    return 1;
  }
  if (state === "idle" || state === "canceled" || state === "cancelled") {
    return null;
  }
  const timing = anim.effect?.getComputedTiming?.();
  if (
    timing !== undefined &&
    typeof timing.progress === "number" &&
    Number.isFinite(timing.progress)
  ) {
    return timing.progress;
  }
  const current =
    typeof anim.currentTime === "number"
      ? anim.currentTime
      : typeof timing?.currentTime === "number"
        ? timing.currentTime
        : null;
  if (current === null || !(track.duration > 0)) {
    return null;
  }
  return sampleEasing(track.easing, current / track.duration);
}

/** Inline clip when nothing is running; computed style only while a clip is in flight. */
function clipBottomOf(el: HTMLElement): number | null {
  const inline = el.style.clipPath;
  if (inline !== "") {
    return parseClipBottom(inline);
  }
  const animations =
    typeof el.getAnimations === "function" ? el.getAnimations() : [];
  if (animations.length === 0) {
    return null;
  }
  return parseClipBottom(getComputedStyle(el).clipPath);
}

export function parseTranslateY(transform: string): number | null {
  const match = /translateY\(([-\d.]+)px\)/.exec(transform);
  if (match?.[1] === undefined) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function readMotionRows(root: HTMLElement): MotionRow[] {
  const out: MotionRow[] = [];
  for (const rowEl of root.querySelectorAll<HTMLElement>(
    ".result-virtual-row",
  )) {
    let motionEl: HTMLElement = rowEl;
    for (const child of rowEl.children) {
      if (
        child instanceof HTMLElement &&
        child.classList.contains("result-row-motion")
      ) {
        motionEl = child;
        break;
      }
    }
    const clipEl = rowEl.querySelector<HTMLElement>("[data-hit-index]");
    const header = rowEl.querySelector<HTMLElement>(".result-group-header");
    const visualEl = clipEl ?? header ?? motionEl;
    const hitRaw = clipEl?.dataset.hitIndex;
    const hitIndex =
      hitRaw !== undefined && Number.isInteger(Number(hitRaw))
        ? Number(hitRaw)
        : null;
    const key =
      rowEl.dataset.rowKey ??
      (hitIndex !== null
        ? `hit:${hitIndex}`
        : `idx:${rowEl.dataset.index ?? ""}`);
    const rect = visualEl.getBoundingClientRect();
    const docStart = parseTranslateY(rowEl.style.transform) ?? 0;
    const tracked = clipEl === null ? null : clipVisualHeight(clipEl);
    const clipBottom =
      tracked === null && clipEl !== null ? clipBottomOf(clipEl) : null;
    out.push({
      key,
      hitIndex,
      rowEl,
      motionEl,
      clipEl,
      top: rect.top,
      docStart,
      borderHeight: rect.height,
      visualHeight: tracked ?? visualHeight(rect.height, clipBottom),
    });
  }
  return out;
}

/**
 * Read every visible row, then cancel only `select`'s rows.
 * Measuring after `stop` would see the post-cancel box and the next
 * animation would jump.
 */
export function snapshotForSwitch(
  root: HTMLElement,
  registry: MotionRegistry,
  select: (rows: readonly MotionRow[]) => ReadonlySet<string>,
): MotionRow[] {
  const rows = readMotionRows(root);
  const keys = select(rows);
  for (const row of rows) {
    if (keys.has(row.key)) {
      registry.stop(row.rowEl);
    }
  }
  return rows;
}

export function clearMotionPaint(row: MotionRow): void {
  row.rowEl.classList.remove("anim");
  row.rowEl.style.overflow = "";
  row.motionEl.style.transform = "";
  row.motionEl.style.clipPath = "";
  const clip = row.clipEl;
  if (clip === null) {
    return;
  }
  clip.style.clipPath = "";
  clip.style.backgroundColor = "";
  clip.style.overflow = "";
  for (const node of clip.querySelectorAll<HTMLElement>(
    ".result-text, .result-xnote, .result-lenchip",
  )) {
    node.style.opacity = "";
  }
}

function defaultAnimate(
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): AnimLike {
  return el.animate(keyframes, options) as unknown as AnimLike;
}

/** Viewport top once the virtualizer's pending `translateY` is on the row. */
/**
 * Viewport top once the virtualizer's pending `translateY` is on the row.
 * Uses the top already stored on `row` so a switch does not force a second
 * layout after the snapshot read.
 */
export function correctedTop(
  row: MotionRow,
  pendingStart: number | undefined,
): number {
  const written = parseTranslateY(row.rowEl.style.transform);
  if (pendingStart === undefined || written === null) {
    return row.top;
  }
  return row.top + (pendingStart - written);
}

/**
 * Document shift of `docStart` that the inline `translateY` does not show yet.
 * The virtualizer sometimes writes the new starts before the border box
 * catches up, and sometimes the other way around. Only the missing part is
 * added, so a start that already moved is not applied twice.
 */
function unseenDocShift(
  docStart: number,
  seen: number,
  pieces: readonly { docStart: number; delta: number }[],
): number {
  let expected = 0;
  for (const piece of pieces) {
    if (piece.docStart < docStart - 0.5) {
      expected += piece.delta;
    }
  }
  if (Math.abs(expected) < 1) {
    return 0;
  }
  const unseen = expected - seen;
  return Math.abs(unseen) < 1 ? 0 : unseen;
}

export function startSwitchMotion(opts: {
  root: HTMLElement;
  registry: MotionRegistry;
  capture: readonly MotionRow[];
  opening: number | null;
  closing: readonly number[];
  anchorStart: number | null;
  scrollDelta: number;
  /**
   * Scroll that will be applied after this call returns, already included
   * in the translate so the read can happen before the scroll write.
   * Pass 0 when `liveRows` were read after that scroll was already written.
   */
  scrollApplied?: number;
  /** Post-scroll rows. Skips a second `getBoundingClientRect` pass. */
  liveRows?: readonly MotionRow[];
  pendingStart: (rowEl: HTMLElement) => number | undefined;
  onCollapseSettled: (index: number) => void;
  /**
   * Final border for an opening or closing row. Used when the element still
   * wears the previous round's border at the `animate` call.
   */
  targetBorder?: (hitIndex: number, opening: boolean) => number | undefined;
  animate?: AnimateFn;
}): void {
  const animate = opts.animate ?? defaultAnimate;
  const scrollApplied = opts.scrollApplied ?? 0;
  const before = new Map(opts.capture.map((row) => [row.key, row]));
  const now = opts.liveRows ?? readMotionRows(opts.root);
  const closing = new Set(opts.closing);
  const finals = new Map<string, number>();
  const layoutPieces: { docStart: number; delta: number }[] = [];
  for (const row of now) {
    const prev = before.get(row.key);
    const isOpen = row.hitIndex !== null && row.hitIndex === opts.opening;
    const isClose = row.hitIndex !== null && closing.has(row.hitIndex);
    let finalBorder = row.borderHeight;
    if (prev !== undefined && row.hitIndex !== null && (isOpen || isClose)) {
      finalBorder = pickLayoutHeight(
        row.borderHeight,
        prev.borderHeight,
        opts.targetBorder?.(row.hitIndex, isOpen),
      );
      const delta = finalBorder - prev.borderHeight;
      if (Math.abs(delta) >= 0.5) {
        layoutPieces.push({ docStart: prev.docStart, delta });
      }
    }
    finals.set(row.key, finalBorder);
  }
  // Read every row's visual top before any animate(). A write between
  // getBoundingClientRect calls forces a layout per row on a long list.
  const visualTop = new Map<string, number>();
  for (const row of now) {
    const prev = before.get(row.key);
    const pending = opts.pendingStart(row.rowEl);
    const written = parseTranslateY(row.rowEl.style.transform);
    // correctedTop already moves the row onto the pending start. Count that
    // as seen, or a start that is about to be written is applied twice.
    const pendingDelta =
      pending !== undefined && written !== null ? pending - written : 0;
    const measured = correctedTop(row, pending) - scrollApplied;
    const seen =
      prev !== undefined ? row.docStart - prev.docStart + pendingDelta : 0;
    const unseen =
      prev !== undefined
        ? unseenDocShift(prev.docStart, seen, layoutPieces)
        : 0;
    visualTop.set(row.key, measured + unseen);
  }
  const causes: HeightCause[] = [];
  for (const row of now) {
    if (row.hitIndex === null) {
      continue;
    }
    const prev = before.get(row.key);
    if (prev === undefined) {
      continue;
    }
    const isOpen = row.hitIndex === opts.opening;
    const isClose = closing.has(row.hitIndex);
    if (!isOpen && !isClose) {
      continue;
    }
    const layoutHeight = finals.get(row.key) ?? row.borderHeight;
    causes.push({
      start: prev.docStart,
      layoutDelta: layoutHeight - prev.borderHeight,
      visualDelta: layoutHeight - prev.visualHeight,
      opening: isOpen,
    });
  }
  const anchorStart = opts.anchorStart ?? Number.POSITIVE_INFINITY;
  let topCause = Number.POSITIVE_INFINITY;
  for (const cause of causes) {
    if (cause.start < topCause) {
      topCause = cause.start;
    }
  }
  // Shared slide for rows the virtualizer mounted only after the snap.
  // They have no "before" rect; they still have to enter with the collapse.
  let shift = 0;
  for (const row of now) {
    if (row.hitIndex === null || !closing.has(row.hitIndex)) {
      continue;
    }
    const prev = before.get(row.key);
    if (prev === undefined) {
      continue;
    }
    const dy = prev.top - (visualTop.get(row.key) ?? row.top);
    if (Math.abs(dy) > Math.abs(shift)) {
      shift = dy;
    }
  }
  for (const row of now) {
    const prev = before.get(row.key);
    const above =
      Number.isFinite(topCause) && row.docStart < topCause - 0.5;
    const isClose = row.hitIndex !== null && closing.has(row.hitIndex);
    const dy =
      prev !== undefined
        ? prev.top - (visualTop.get(row.key) ?? row.top)
        : above
          ? shift
          : 0;
    if (prev === undefined && Math.abs(dy) < 0.5) {
      continue;
    }
    const token = opts.registry.token(row.rowEl);
    const openingSelf = row.hitIndex !== null && row.hitIndex === opts.opening;
    const pieces = translatePlan(
      dy,
      prev?.docStart ?? row.docStart,
      anchorStart,
      causes,
      opts.scrollDelta,
      openingSelf ? "open" : isClose ? "close" : "none",
    );
    for (const piece of pieces) {
      opts.registry.track(
        row.rowEl,
        token,
        animate(
          row.motionEl,
          [
            { transform: `translateY(${formatPx(piece.fromY)})` },
            { transform: "translateY(0px)" },
          ],
          {
            duration: piece.duration,
            easing: piece.easing,
            fill: "both",
            composite: "add",
          },
        ),
        "move",
      );
    }
    if (prev === undefined) {
      continue;
    }
    if (row.clipEl === null || row.hitIndex === null) {
      continue;
    }
    const isOpen = row.hitIndex === opts.opening;
    if (!isOpen && !isClose) {
      continue;
    }
    const layoutHeight = finals.get(row.key) ?? row.borderHeight;
    const range = clipRange(layoutHeight, prev.visualHeight);
    if (range !== null) {
      const clipDuration = isOpen ? EXPAND_MS : COLLAPSE_MS;
      const clipEasing = isOpen ? EXPAND_EASE : COLLAPSE_EASE;
      const clipAnim = animate(
        row.clipEl,
        [{ clipPath: range.from }, { clipPath: range.to }],
        {
          duration: clipDuration,
          easing: clipEasing,
          fill: "both",
        },
      );
      rememberClip(
        row.clipEl,
        clipAnim,
        prev.visualHeight,
        layoutHeight,
        clipDuration,
        clipEasing,
      );
      opts.registry.track(
        row.rowEl,
        token,
        clipAnim,
        "clip",
        isClose
          ? () => {
              opts.onCollapseSettled(row.hitIndex as number);
            }
          : undefined,
      );
    } else if (isClose) {
      opts.onCollapseSettled(row.hitIndex);
    }
    if (isOpen) {
      playExpandFades(row.clipEl, row.rowEl, token, opts.registry, animate);
    } else {
      playCollapseMark(row.clipEl, row.rowEl, token, opts.registry, animate);
    }
  }
  opts.registry.scheduleSweep(opts.root);
}

function playExpandFades(
  clipEl: HTMLElement,
  owner: HTMLElement,
  token: number,
  registry: MotionRegistry,
  animate: AnimateFn,
): void {
  const text = clipEl.querySelector<HTMLElement>(".result-text");
  if (text !== null) {
    registry.track(
      owner,
      token,
      animate(text, [{ opacity: TEXT_FADE_FROM }, { opacity: 1 }], {
        duration: EXPAND_MS * TEXT_FADE_SCALE,
        easing: "ease-out",
        fill: "both",
      }),
      "fade",
    );
  }
  const note = clipEl.querySelector<HTMLElement>(".result-xnote");
  if (note !== null) {
    registry.track(
      owner,
      token,
      animate(note, [{ opacity: 0 }, { opacity: 1 }], {
        duration: EXPAND_MS * NOTE_DURATION_SCALE,
        delay: EXPAND_MS * NOTE_DELAY_SCALE,
        easing: "ease-out",
        fill: "both",
      }),
      "fade",
    );
  }
  // A selected row under the pointer keeps `--selected` (`:hover` wins).
  // Fading it to `--hover` would snap back when the animation is removed.
  if (clipEl.classList.contains("selected") && clipEl.matches(":hover")) {
    return;
  }
  registry.track(
    owner,
    token,
    animate(
      clipEl,
      [
        { backgroundColor: resolvedToken(clipEl, "--selected") },
        { backgroundColor: resolvedToken(clipEl, "--hover") },
      ],
      { duration: EXPAND_MS + BG_EXTRA_MS, easing: "ease-out", fill: "both" },
    ),
    "fade",
  );
}

let warmedKey = "";
const warmedColors = new Map<string, string>();

function usableColor(value: string): boolean {
  return (
    value !== "" &&
    !value.includes("var(") &&
    value !== "transparent" &&
    value !== "rgba(0, 0, 0, 0)"
  );
}

/** Read `--selected` / `--hover` once per theme so a switch does not force layout. */
export function warmMotionColors(el: HTMLElement): void {
  const key = document.documentElement.className;
  if (
    warmedKey === key &&
    warmedColors.has("--selected") &&
    warmedColors.has("--hover")
  ) {
    return;
  }
  warmedKey = key;
  for (const name of ["--selected", "--hover"] as const) {
    const value = readResolvedColor(el, name);
    if (usableColor(value)) {
      warmedColors.set(name, value);
    } else {
      warmedColors.delete(name);
    }
  }
}

/** Resolved color so the background fade interpolates. `var()` in a keyframe often snaps. */
function resolvedToken(
  el: HTMLElement,
  name: "--selected" | "--hover",
): string {
  if (document.documentElement.className === warmedKey) {
    const cached = warmedColors.get(name);
    if (cached !== undefined) {
      return cached;
    }
  }
  const value = readResolvedColor(el, name);
  if (usableColor(value)) {
    warmedKey = document.documentElement.className;
    warmedColors.set(name, value);
  }
  return value;
}

function readResolvedColor(
  el: HTMLElement,
  name: "--selected" | "--hover",
): string {
  const previous = el.style.backgroundColor;
  el.style.backgroundColor = `var(${name})`;
  const resolved = getComputedStyle(el).backgroundColor;
  el.style.backgroundColor = previous;
  if (!usableColor(resolved)) {
    return `var(${name})`;
  }
  return resolved;
}

function playCollapseMark(
  clipEl: HTMLElement,
  owner: HTMLElement,
  token: number,
  registry: MotionRegistry,
  animate: AnimateFn,
): void {
  const mark = clipEl.querySelector<HTMLElement>(".result-lenchip.is-motion");
  if (mark === null) {
    return;
  }
  registry.track(
    owner,
    token,
    animate(mark, [{ opacity: 0 }, { opacity: 1 }], {
      duration: COLLAPSE_MS * MARK_DURATION_SCALE,
      delay: COLLAPSE_MS * MARK_DELAY_SCALE,
      easing: "ease-out",
      fill: "both",
    }),
    "fade",
  );
}

export function cancelPaint(root: HTMLElement, registry: MotionRegistry): void {
  for (const row of readMotionRows(root)) {
    registry.stop(row.rowEl);
    clearMotionPaint(row);
  }
}
