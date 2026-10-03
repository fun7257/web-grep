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

/** Bottom inset of `inset(top right bottom left)`, in px. Negative shows overflow. */
export function parseClipBottom(clipPath: string): number | null {
  const match =
    /inset\(\s*([-.\d]+)px\s+([-.\d]+)px\s+([-.\d]+)px\s+([-.\d]+)px\s*\)/.exec(
      clipPath,
    );
  if (match?.[3] === undefined) {
    return null;
  }
  const value = Number(match[3]);
  return Number.isFinite(value) ? value : null;
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
  opening: boolean;
};

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
    if (Math.abs(cause.layoutDelta) < 0.5) {
      continue;
    }
    const docPart = cause.start < rowStart - 0.5 ? cause.layoutDelta : 0;
    // Scroll is a one-shot. It only cancels layout shift for rows the cause
    // actually pushed. A row above the cause just rides the scroll.
    const scrollPart =
      docPart !== 0 && cause.start < anchorStart - 0.5
        ? cause.layoutDelta * scale
        : 0;
    const fromY = -(docPart - scrollPart);
    if (Math.abs(fromY) < 0.5) {
      continue;
    }
    explained += fromY;
    pieces.push({
      fromY,
      duration: cause.opening ? EXPAND_MS : COLLAPSE_MS,
      easing: cause.opening ? EXPAND_EASE : COLLAPSE_EASE,
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
    pieces.push({
      fromY: residual,
      duration: longest?.duration ?? (residual > 0 ? COLLAPSE_MS : EXPAND_MS),
      easing: longest?.easing ?? (residual > 0 ? COLLAPSE_EASE : EXPAND_EASE),
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
 * A closing row's clip runs on the collapse clock. Its translate has to use
 * that same clock or the bottom edge drifts through the row below. Rows above
 * the change use it too: scroll has already parked them at the final layout
 * position, and they must slide back with the closing row's top. Everyone
 * else keeps the per-cause split (collapse 170ms and expand 240ms together).
 */
export function translatePlan(
  visualDy: number,
  aboveOrClosing: boolean,
  rowStart: number,
  anchorStart: number,
  causes: readonly HeightCause[],
  scrollDelta: number,
): TranslatePiece[] {
  if (aboveOrClosing) {
    if (Math.abs(visualDy) < 0.5) {
      return [];
    }
    return [{ fromY: visualDy, duration: COLLAPSE_MS, easing: COLLAPSE_EASE }];
  }
  return planTranslatePieces(
    visualDy,
    rowStart,
    anchorStart,
    causes,
    scrollDelta,
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

export type AnimLike = {
  cancel: () => void;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
  playState?: string;
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
    const clipBottom = clipEl === null ? null : clipBottomOf(clipEl);
    out.push({
      key,
      hitIndex,
      rowEl,
      motionEl,
      clipEl,
      top: rect.top,
      docStart,
      borderHeight: rect.height,
      visualHeight: visualHeight(rect.height, clipBottom),
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
  animate?: AnimateFn;
}): void {
  const animate = opts.animate ?? defaultAnimate;
  const scrollApplied = opts.scrollApplied ?? 0;
  const before = new Map(opts.capture.map((row) => [row.key, row]));
  const now = opts.liveRows ?? readMotionRows(opts.root);
  // Read every row's visual top before any animate(). A write between
  // getBoundingClientRect calls forces a layout per row on a long list.
  const visualTop = new Map<string, number>();
  for (const row of now) {
    visualTop.set(
      row.key,
      correctedTop(row, opts.pendingStart(row.rowEl)) - scrollApplied,
    );
  }
  const causes: HeightCause[] = [];
  const closing = new Set(opts.closing);
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
    causes.push({
      start: prev.docStart,
      layoutDelta: row.borderHeight - prev.borderHeight,
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
    const pieces = translatePlan(
      dy,
      above || isClose,
      prev?.docStart ?? row.docStart,
      anchorStart,
      causes,
      opts.scrollDelta,
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
    const range = clipRange(row.borderHeight, prev.visualHeight);
    if (range !== null) {
      opts.registry.track(
        row.rowEl,
        token,
        animate(
          row.clipEl,
          [{ clipPath: range.from }, { clipPath: range.to }],
          {
            duration: isOpen ? EXPAND_MS : COLLAPSE_MS,
            easing: isOpen ? EXPAND_EASE : COLLAPSE_EASE,
            fill: "both",
          },
        ),
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
