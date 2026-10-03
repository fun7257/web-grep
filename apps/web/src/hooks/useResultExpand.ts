import type { Virtualizer } from "@tanstack/react-virtual";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  affectedKeys,
  cancelPaint,
  clearMotionPaint,
  MotionRegistry,
  type MotionRow,
  parseTranslateY,
  readMotionRows,
  shouldAnimateMotion,
  snapshotForSwitch,
  startSwitchMotion,
  warmMotionColors,
} from "../resultExpandMotion.ts";
import {
  absorbAnchorShift,
  hitExpandKey,
  PIN_SLOP_PX,
  pickReleaseAnchor,
  pointerRestBlocked,
  type VisibleHitBox,
} from "../resultExpandPlan.ts";

/** Pointer must sit still this long before a row opens or closes. */
export const HOVER_REST_MS = 50;
/** Scroll events inside this window suppress hover changes. */
export const SCROLL_IDLE_MS = 150;

export type RowOpen = { index: number; source: "pointer" | "keyboard" };

export type Hold = { index: number; height: number };

type ListVirtualizer = Virtualizer<HTMLDivElement, Element>;

type RowMeasure = { start: number; size: number };

/** Full measurement cache. The public virtual-item list is only the window. */
function measuredRows(
  virtualizer: ListVirtualizer,
): readonly (RowMeasure | undefined)[] {
  const cache = virtualizer as unknown as {
    getMeasurements(): readonly (RowMeasure | undefined)[];
  };
  return cache.getMeasurements();
}

type VirtualizerHost = ListVirtualizer & {
  isScrolling: boolean;
  scrollOffset: number | null;
};

function absorbNotify(virtualizer: ListVirtualizer): void {
  const host = virtualizer as unknown as { maybeNotify?: () => void };
  host.maybeNotify?.();
}

/** Closed row heights learned from a real measure. Shared with `estimateSize`. */
type ClosedGuess = { chip: number; plain: number };

/**
 * Expanded height of a closed chip row, read from a clone so the gesture
 * itself does not lay out to discover it. `0` means not measured yet.
 */
function warmOpenHeights(
  root: HTMLElement,
  widths: number,
  openSizes: Map<number, number>,
): void {
  if (widths <= 0) {
    return;
  }
  const pending: HTMLElement[] = [];
  for (const button of root.querySelectorAll<HTMLElement>(".result-log")) {
    if (button.classList.contains("is-open")) {
      continue;
    }
    if (button.querySelector(".result-lenchip") === null) {
      continue;
    }
    const index = Number(button.dataset.hitIndex);
    if (!Number.isInteger(index) || openSizes.has(index)) {
      continue;
    }
    pending.push(button);
  }
  if (pending.length === 0) {
    return;
  }
  const clones: Array<{ index: number; node: HTMLElement }> = [];
  for (const button of pending) {
    const clone = button.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      continue;
    }
    const index = Number(button.dataset.hitIndex);
    clone.classList.add("is-open");
    clone.removeAttribute("style");
    for (const chip of clone.querySelectorAll(".result-lenchip")) {
      chip.remove();
    }
    const main = clone.querySelector(".result-log-main");
    if (main instanceof HTMLElement && clone.querySelector(".result-xnote") === null) {
      const note = document.createElement("span");
      note.className = "result-xnote";
      const label = document.createElement("b");
      label.textContent = "整行";
      const gap = document.createElement("span");
      gap.className = "result-xnote-gap";
      const hint = document.createElement("span");
      hint.className = "result-xnote-hint";
      hint.textContent = "点击在右侧渲染";
      note.append(label, gap, hint);
      main.append(note);
    }
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    clone.style.width = `${widths}px`;
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    root.append(clone);
    clones.push({ index, node: clone });
  }
  for (const clone of clones) {
    const height = Math.round(clone.node.getBoundingClientRect().height);
    if (Number.isInteger(clone.index) && height > 0) {
      openSizes.set(clone.index, height);
    }
  }
  for (const clone of clones) {
    clone.node.remove();
  }
}

/**
 * Size changes notify React. A switch is allowed two commits total, so the
 * measurement pass swallows that notify and writes positions itself.
 * `maybeNotify` still runs so a later scroll-idle sees unchanged deps.
 */
function silenceVirtualizer(virtualizer: ListVirtualizer): () => void {
  const host = virtualizer as VirtualizerHost;
  const previous = host.options.onChange;
  host.options.onChange = () => {};
  return () => {
    host.isScrolling = false;
    absorbNotify(virtualizer);
    host.options.onChange = previous;
  };
}

function writeVirtualPositions(
  root: HTMLElement,
  virtualizer: ListVirtualizer,
): void {
  const inner = root.querySelector<HTMLElement>(".result-list-inner");
  if (inner !== null) {
    const height = `${virtualizer.getTotalSize()}px`;
    if (inner.style.height !== height) {
      inner.style.height = height;
    }
  }
  const measurements = measuredRows(virtualizer);
  for (const rowEl of root.querySelectorAll<HTMLElement>(
    ".result-virtual-row",
  )) {
    const index = Number(rowEl.dataset.index);
    const start = measurements[index]?.start;
    if (start === undefined) {
      continue;
    }
    const next = `translateY(${start}px)`;
    if (rowEl.style.transform !== next) {
      rowEl.style.transform = next;
    }
  }
}

function commitScrollTopDom(
  root: HTMLElement,
  virtualizer: ListVirtualizer,
  next: number,
): void {
  const host = virtualizer as VirtualizerHost;
  root.dataset.motionPin = "1";
  // The offset observer bails only while isScrolling is already true and the
  // cached offset matches. The scroll event itself is a later task, so these
  // stay set until `releasePinnedScroll` runs after that task.
  host.isScrolling = true;
  host.scrollOffset = next;
  root.scrollTop = next;
}

/**
 * useVirtualizer restores onChange during render, and row refs measure
 * before any layout effect. Re-parking has to happen in that same render.
 */
function reparkDuringRender(
  held: { current: boolean },
  parked: { current: (() => void) | null },
  virtualizer: ListVirtualizer,
): void {
  if (!held.current) {
    return;
  }
  parked.current = silenceVirtualizer(virtualizer);
}

/** Keep the scroll publisher current without recreating commitModel. */
function publishScroll(
  slot: { current: (top: number) => boolean },
  publish: (top: number) => boolean,
): void {
  slot.current = publish;
}

/** Drop the programmatic-scroll guard after its event has been delivered. */
function releasePinnedScroll(
  root: HTMLElement | null,
  virtualizer: ListVirtualizer,
): void {
  const host = virtualizer as VirtualizerHost;
  host.isScrolling = false;
  if (root !== null) {
    delete root.dataset.motionPin;
  }
  // Deps move to isScrolling=false while onChange is still the guard, so the
  // library's 150ms scroll-end does not schedule another commit.
  absorbNotify(virtualizer);
}

/** One scroll correction from the rows already read. Does not write. */
function predictPinShift(
  root: HTMLElement,
  virtualizer: ListVirtualizer,
  pin: Pin | null,
  settled: boolean,
  rows: readonly MotionRow[],
  hitVirtualIndex: (hitIndex: number) => number,
  metrics?: { scrollTop: number; clientHeight: number; scrollHeight: number },
): number {
  if (pin === null || settled || hitExpandKey(pin.index) !== pin.key) {
    return 0;
  }
  const row = rows.find((item) => item.hitIndex === pin.index);
  if (row === undefined) {
    return 0;
  }
  const virtualIndex = hitVirtualIndex(pin.index);
  const start =
    virtualIndex < 0
      ? undefined
      : measuredRows(virtualizer)[virtualIndex]?.start;
  const written = parseTranslateY(row.rowEl.style.transform);
  const visual =
    start !== undefined && written !== null
      ? row.top + (start - written)
      : row.top;
  const scrollTop = metrics?.scrollTop ?? root.scrollTop;
  const clientHeight = metrics?.clientHeight ?? root.clientHeight;
  const scrollHeight = metrics?.scrollHeight ?? root.scrollHeight;
  const maxScroll = Math.max(
    0,
    Math.max(scrollHeight, virtualizer.getTotalSize()) - clientHeight,
  );
  return absorbAnchorShift(scrollTop, visual - pin.top, maxScroll);
}

type ExpandModel = {
  /** The row the pointer or the keyboard currently wants open. */
  active: RowOpen | null;
};

const EMPTY_MODEL: ExpandModel = { active: null };

const NAV_KEYS = new Set(["j", "k", "ArrowUp", "ArrowDown"]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** j/k/arrows with no modifiers, before another listener has claimed the event. */
function isPlainListNav(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }
  return NAV_KEYS.has(event.key) && !isEditableTarget(event.target);
}

function indexFromElement(node: Element): number | null {
  const row = node.closest("[data-hit-index]");
  if (row === null) {
    return null;
  }
  const value = Number(row.getAttribute("data-hit-index"));
  return Number.isInteger(value) ? value : null;
}

/** translateY already written on the row. The measurement cache can be ahead of it. */
function writtenTranslateY(el: HTMLElement): number | null {
  const row = el.closest(".result-virtual-row");
  if (!(row instanceof HTMLElement)) {
    return null;
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(row.style.transform);
  if (match?.[1] === undefined) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Viewport top the anchor will have once React writes the cached translateY,
 * at the current scrollTop. A size change above the anchor updates the cache
 * inside this layout effect, before the style commit, and total height can
 * stay the same (one row shrinks, the anchor grows), so the effect must not
 * wait for another commit to see the shift.
 */
function pendingAnchorTop(
  el: HTMLElement,
  virtualizer: ListVirtualizer,
  virtualIndex: number,
): number {
  const live = el.getBoundingClientRect().top;
  if (virtualIndex < 0) {
    return live;
  }
  const start = measuredRows(virtualizer)[virtualIndex]?.start;
  const written = writtenTranslateY(el);
  if (start === undefined || written === null) {
    return live;
  }
  return live + (start - written);
}

type Pin = { index: number; key: string; top: number };

/**
 * Hit the next fold/sort/leave should keep still, read before the DOM commit.
 * Height 0 means jsdom (no layout): skip the pin rather than invent a delta.
 * The stable key is `hit:${originalIndex}` (`data-hit-index`). Sort and fold
 * do not renumber hits; a key missing after the commit is not pinned.
 */
function releaseAnchorIndex(
  root: HTMLElement | null,
  lastPointerIndex: number | null,
): number | null {
  if (root === null) {
    return null;
  }
  const view = root.getBoundingClientRect();
  if (view.height <= 0) {
    return null;
  }
  const visible: VisibleHitBox[] = [];
  for (const node of root.querySelectorAll<HTMLElement>("[data-hit-index]")) {
    const index = Number(node.dataset.hitIndex);
    if (!Number.isInteger(index)) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0) {
      continue;
    }
    visible.push({
      index,
      key: hitExpandKey(index),
      top: rect.top,
      bottom: rect.bottom,
    });
  }
  const last =
    lastPointerIndex === null
      ? null
      : { index: lastPointerIndex, key: hitExpandKey(lastPointerIndex) };
  return pickReleaseAnchor(last, visible, view.top, view.bottom)?.index ?? null;
}

function assignPin(
  pinRef: { current: Pin | null },
  settledRef: { current: boolean },
  root: HTMLElement | null,
  index: number | null,
): void {
  if (root === null || index === null) {
    pinRef.current = null;
    settledRef.current = true;
    return;
  }
  const el = root.querySelector<HTMLElement>(`[data-hit-index="${index}"]`);
  if (el === null) {
    pinRef.current = null;
    settledRef.current = true;
    return;
  }
  const rect = el.getBoundingClientRect();
  // jsdom has no layout box. Skip compensation rather than invent a delta.
  if (rect.height <= 0) {
    pinRef.current = null;
    settledRef.current = true;
    return;
  }
  pinRef.current = { index, key: hitExpandKey(index), top: rect.top };
  settledRef.current = false;
}

function sameModel(a: ExpandModel, b: ExpandModel): boolean {
  return (
    a.active?.index === b.active?.index && a.active?.source === b.active?.source
  );
}

function openHitIndexes(model: ExpandModel): number[] {
  return model.active === null ? [] : [model.active.index];
}

function clampModel(model: ExpandModel, hitCount: number): ExpandModel {
  const active =
    model.active !== null && model.active.index < hitCount
      ? model.active
      : null;
  return { active };
}

function hasWaapi(): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.animate === "function"
  );
}

type PendingPlay = {
  capture: readonly MotionRow[];
  opening: number | null;
  closing: number[];
  anchorStart: number | null;
  scrollBefore: number;
  /** Viewport size read before animations are cancelled. */
  clientHeight: number;
  scrollHeight: number;
  /** Scroll correction decided with the model update, before paint. */
  applied: number;
  played: boolean;
};

/**
 * One hover timer for the whole list (event delegation). Opens a truncated
 * row after the pointer rests. The row under the pointer keeps its viewport
 * top when scrollTop can absorb the shift; otherwise the rows below slide.
 * An open row above the anchor always closes — nothing is kept open just
 * because the list is already at the top.
 */
export function useResultExpand(opts: {
  listRef: RefObject<HTMLDivElement | null>;
  virtualizer: ListVirtualizer;
  hitVirtualIndex: (hitIndex: number) => number;
  /** Hit identity. A new search (different first hit) drops open state. */
  hits: readonly unknown[];
  /** Selection. A change is a keyboard expand only if a plain j/k/arrow just fired. */
  selectedIndex: number;
  /** Group fold / sort. Pins are re-applied when this changes. */
  structureKey: string;
  /**
   * Publish a pinned `scrollTop` into React. Return whether the state
   * changed. Motion defers this so the pin itself does not commit.
   */
  commitScrollTop: (top: number) => boolean;
}): {
  openIndexes: ReadonlySet<number>;
  /** Collapsing rows: layout height is final, expanded text stays until the clip ends. */
  holdHeights: readonly Hold[];
  reportTruncation: (index: number, truncated: boolean) => void;
  /** Re-pin after sort's selection scroll. No-op unless a fold/sort pin is pending. */
  settleStructurePin: () => void;
  /**
   * Call synchronously from a fold or sort handler, before the state update.
   * The anchor top has to be read while the previous layout is still on screen.
   */
  prepareStructurePin: () => void;
} {
  const {
    listRef,
    virtualizer,
    hitVirtualIndex,
    hits,
    selectedIndex,
    structureKey,
    commitScrollTop,
  } = opts;
  const [modelState, setModelState] = useState<ExpandModel>(EMPTY_MODEL);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [measureTick, setMeasureTick] = useState(0);
  const modelRef = useRef<ExpandModel>(EMPTY_MODEL);
  const holdsRef = useRef<Hold[]>([]);
  const truncRef = useRef(new Map<number, boolean>());
  const pendingKey = useRef<number | null>(null);
  const pointerRef = useRef({
    x: 0,
    y: 0,
    index: null as number | null,
    inside: false,
  });
  const scrollingRef = useRef(false);
  const restTimer = useRef<number | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const ignoreScroll = useRef(0);
  const pinRef = useRef<Pin | null>(null);
  const pinSettled = useRef(true);
  /** Last hit the pointer was on. Not cleared when the pointer leaves a row. */
  const lastPointerIndex = useRef<number | null>(null);
  /** Hold the pin across the selection scroll that sort fires after paint. */
  const structurePin = useRef(false);
  const adjusting = useRef(false);
  const virtualizerRef = useRef(virtualizer);
  const lookupRef = useRef(hitVirtualIndex);
  const closedSizeRef = useRef(new Map<number, number>());
  const openSizeRef = useRef(new Map<number, number>());
  const closedGuess = useRef<ClosedGuess>({ chip: 0, plain: 0 });
  const scrollGuard = useRef(0);
  const keyNav = useRef(false);
  const keyNavGen = useRef(0);
  const keyRepeat = useRef(false);
  const truncGen = useRef(0);
  const reducedRef = useRef(false);
  const lastSwitchAt = useRef<number | null>(null);
  const pendingPlay = useRef<PendingPlay | null>(null);
  /**
   * Hold-release renders still measure, but they must not start motion again.
   * Row refs measure during commit, before this layout effect, so the
   * virtualizer notify is parked across that commit.
   */
  const skipMeasure = useRef(false);
  const parkedSilence = useRef<(() => void) | null>(null);
  const silenceHeld = useRef(false);
  const parkSilence = useCallback((): void => {
    if (silenceHeld.current || parkedSilence.current !== null) {
      return;
    }
    parkedSilence.current = silenceVirtualizer(virtualizerRef.current);
    silenceHeld.current = true;
  }, []);
  // useVirtualizer calls setOptions during render and puts the real
  // onChange back. Re-park after that, still before commit-phase refs.
  /* oxlint-disable react/refs */
  reparkDuringRender(silenceHeld, parkedSilence, virtualizer);
  /* oxlint-enable react/refs */
  const releaseGen = useRef(0);
  const commitScrollRef = useRef(commitScrollTop);
  /* oxlint-disable react/refs */
  publishScroll(commitScrollRef, commitScrollTop);
  /* oxlint-enable react/refs */
  /** Bumped when a search or fold/sort should drop in-flight motion before paint. */
  const [motionCut, setMotionCut] = useState(0);
  const appliedCut = useRef(0);
  const registry = useRef(new MotionRegistry());
  const seriesHead = hits.length === 0 ? null : hits[0];
  const [trackedHead, setTrackedHead] = useState<unknown>(seriesHead);
  const [generation, setGeneration] = useState(0);
  const [trackedStructure, setTrackedStructure] = useState(structureKey);
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  const setHoldsTracked = useCallback(
    (update: Hold[] | ((prev: Hold[]) => Hold[])) => {
      setHolds((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        holdsRef.current = next;
        return next;
      });
    },
    [],
  );

  let model = modelState;
  if (trackedHead !== seriesHead) {
    setTrackedHead(seriesHead);
    setGeneration((value) => value + 1);
    model = EMPTY_MODEL;
    setModelState(model);
    if (holds.length > 0) {
      setHolds([]);
    }
    setMotionCut((value) => value + 1);
  } else if (trackedStructure !== structureKey) {
    setTrackedStructure(structureKey);
    // Fold/sort already captured the anchor in prepareStructurePin, before
    // this render. Bump the layout epoch so that pin is applied after the
    // new row set commits. scrollTop that cannot absorb the shift is left
    // alone: no spacer, no delayed collapse (see absorbAnchorShift).
    setLayoutEpoch(layoutEpoch + 1);
    setMotionCut((value) => value + 1);
    if (holds.length > 0) {
      setHolds([]);
    }
  } else {
    const clamped = clampModel(model, hits.length);
    if (!sameModel(model, clamped)) {
      model = clamped;
      setModelState(model);
    }
  }

  const setModel = useCallback((next: ExpandModel) => {
    modelRef.current = next;
    setModelState((prev) => {
      if (sameModel(prev, next)) {
        return prev;
      }
      return next;
    });
  }, []);

  const capturePin = useCallback(
    (index: number | null) => {
      assignPin(pinRef, pinSettled, listRef.current, index);
    },
    [listRef],
  );

  const commitModel = useCallback(
    (next: ExpandModel, anchor: number | null, fromKey = false) => {
      if (sameModel(modelRef.current, next)) {
        modelRef.current = next;
        return;
      }
      // Row refs measure in the commit phase, before the layout effect.
      // Park the notify first so that measurement cannot schedule a render.
      parkSilence();
      const repeat = fromKey ? keyRepeat.current : false;
      if (fromKey) {
        keyRepeat.current = false;
      }
      const now = performance.now();
      const since =
        lastSwitchAt.current === null ? null : now - lastSwitchAt.current;
      const play = shouldAnimateMotion({
        reducedMotion: reducedRef.current,
        scrolling: scrollingRef.current,
        keyRepeat: repeat,
        sinceLastMs: since,
        waapi: hasWaapi(),
      });
      lastSwitchAt.current = now;
      releaseGen.current += 1;
      const prevOpen = openHitIndexes(modelRef.current);
      const nextOpen = next.active?.index ?? null;
      const closing = prevOpen.filter((index) => index !== nextOpen);
      const opening =
        nextOpen !== null && !prevOpen.includes(nextOpen) ? nextOpen : null;
      const root = listRef.current;
      const motionClosing = [...closing];
      for (const hold of holdsRef.current) {
        if (hold.index !== opening && !motionClosing.includes(hold.index)) {
          motionClosing.push(hold.index);
        }
      }
      const selectKeys = (rows: readonly MotionRow[]): Set<string> => {
        const anchorRow =
          anchor === null
            ? undefined
            : rows.find((row) => row.hitIndex === anchor);
        const anchorStart = anchorRow?.docStart ?? null;
        const marks: { hitIndex: number; docStart: number }[] = [];
        let unknown = false;
        for (const index of motionClosing) {
          const row = rows.find((item) => item.hitIndex === index);
          if (row === undefined) {
            continue;
          }
          marks.push({ hitIndex: index, docStart: row.docStart });
          const closed = closedSizeRef.current.get(index);
          if (
            (closed === undefined || closed <= 0) &&
            anchorStart !== null &&
            row.docStart < anchorStart - 0.5
          ) {
            unknown = true;
          }
        }
        if (opening !== null) {
          const row = rows.find((item) => item.hitIndex === opening);
          if (row !== undefined) {
            marks.push({ hitIndex: opening, docStart: row.docStart });
          }
        }
        return affectedKeys(rows, marks, unknown);
      };
      if (root !== null && (motionClosing.length > 0 || opening !== null)) {
        if (play) {
          // Read scroll metrics before cancel. A later read would be its own layout.
          const scrollBefore = root.scrollTop;
          const clientHeight = root.clientHeight;
          const scrollHeight = root.scrollHeight;
          const captured = snapshotForSwitch(
            root,
            registry.current,
            selectKeys,
          );
          const anchorRow =
            anchor === null
              ? undefined
              : captured.find((row) => row.hitIndex === anchor);
          pendingPlay.current = {
            capture: captured,
            opening,
            closing: motionClosing,
            anchorStart: anchorRow?.docStart ?? null,
            scrollBefore,
            clientHeight,
            scrollHeight,
            applied: 0,
            played: false,
          };
          const kept = holdsRef.current.filter(
            (hold) => hold.index !== opening,
          );
          const added: Hold[] = [];
          for (const index of closing) {
            const height = closedSizeRef.current.get(index);
            if (height === undefined || height <= 0) {
              continue;
            }
            if (kept.some((hold) => hold.index === index)) {
              continue;
            }
            added.push({ index, height });
          }
          setHoldsTracked([...kept, ...added]);
        } else {
          const captured = snapshotForSwitch(
            root,
            registry.current,
            selectKeys,
          );
          const keys = selectKeys(captured);
          for (const row of captured) {
            if (keys.has(row.key)) {
              clearMotionPaint(row);
            }
          }
          pendingPlay.current = null;
          setHoldsTracked([]);
        }
      } else {
        pendingPlay.current = null;
        setHoldsTracked([]);
      }
      // The render reads getTotalSize() before refs measure. Seed the cache
      // from sizes we already know so that render writes the final inner
      // height and does not dirty layout again after the measurement read.
      const list = virtualizerRef.current;
      const applySize = (hitIndex: number, height: number | undefined): void => {
        if (height === undefined || !(height > 0)) {
          return;
        }
        const virtualIndex = lookupRef.current(hitIndex);
        if (virtualIndex < 0) {
          return;
        }
        list.resizeItem(virtualIndex, height);
      };
      for (const index of closing) {
        applySize(index, closedSizeRef.current.get(index));
      }
      if (opening !== null) {
        applySize(opening, openSizeRef.current.get(opening));
      }
      const pendingNow = pendingPlay.current;
      if (
        pendingNow !== null &&
        !pendingNow.played &&
        root !== null &&
        pendingNow.capture.length > 0
      ) {
        const anchorRow =
          anchor === null
            ? undefined
            : pendingNow.capture.find((row) => row.hitIndex === anchor);
        if (
          anchor !== null &&
          anchorRow !== undefined &&
          anchorRow.borderHeight > 0
        ) {
          pinRef.current = {
            index: anchor,
            key: hitExpandKey(anchor),
            top: anchorRow.top,
          };
          pinSettled.current = false;
        } else {
          capturePin(anchor);
        }
        // Same turn as setModel / setHolds, so the pin is not its own commit.
        const applied = predictPinShift(
          root,
          list,
          pinRef.current,
          pinSettled.current,
          pendingNow.capture,
          lookupRef.current,
          {
            scrollTop: pendingNow.scrollBefore,
            clientHeight: pendingNow.clientHeight,
            scrollHeight: pendingNow.scrollHeight,
          },
        );
        pendingNow.applied = applied;
        if (applied !== 0) {
          commitScrollRef.current(pendingNow.scrollBefore + applied);
        }
      } else {
        capturePin(anchor);
      }
      setModel(next);
    },
    [capturePin, listRef, parkSilence, setHoldsTracked, setModel],
  );

  const reportTruncation = useCallback(
    (index: number, truncated: boolean, remeasure = true) => {
      if (truncGen.current !== generation) {
        truncRef.current.clear();
        truncGen.current = generation;
        pendingKey.current = null;
      }
      const prev = truncRef.current.get(index);
      truncRef.current.set(index, truncated);
      // The row already painted this chip, so the commit-phase measure saw
      // the final height. A parent render here would be an extra commit.
      if (
        remeasure &&
        prev !== truncated &&
        (truncated || prev === true)
      ) {
        setMeasureTick((tick) => tick + 1);
      }
      if (pendingKey.current !== index) {
        return;
      }
      pendingKey.current = null;
      if (!truncated) {
        return;
      }
      commitModel({ active: { index, source: "keyboard" } }, index, true);
    },
    [commitModel, generation],
  );

  const onKeyboardNav = useCallback(
    (index: number) => {
      if (truncGen.current !== generation) {
        truncRef.current.clear();
        truncGen.current = generation;
        pendingKey.current = null;
      }
      const known = truncRef.current.get(index);
      if (known === true) {
        pendingKey.current = null;
        commitModel({ active: { index, source: "keyboard" } }, index, true);
        return;
      }
      if (known === false) {
        pendingKey.current = null;
        commitModel({ active: null }, index, true);
        return;
      }
      pendingKey.current = index;
      commitModel({ active: null }, index, true);
    },
    [commitModel, generation],
  );
  const onKeyboardNavRef = useRef(onKeyboardNav);

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer;
    lookupRef.current = hitVirtualIndex;
  });

  useLayoutEffect(() => {
    modelRef.current = model;
    onKeyboardNavRef.current = onKeyboardNav;
    holdsRef.current = holds;
  });

  const seenSelected = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (seenSelected.current === null) {
      seenSelected.current = selectedIndex;
      return;
    }
    if (seenSelected.current === selectedIndex) {
      return;
    }
    seenSelected.current = selectedIndex;
    if (!keyNav.current) {
      return;
    }
    keyNav.current = false;
    keyNavGen.current += 1;
    onKeyboardNavRef.current(selectedIndex);
  }, [selectedIndex]);

  useLayoutEffect(() => {
    pendingKey.current = null;
    pinRef.current = null;
    pinSettled.current = true;
    pointerRef.current.index = null;
    lastPointerIndex.current = null;
    structurePin.current = false;
    scrollingRef.current = false;
    closedSizeRef.current.clear();
    openSizeRef.current.clear();
    closedGuess.current.chip = 0;
    closedGuess.current.plain = 0;
    scrollGuard.current += 1;
    pendingPlay.current = null;
    lastSwitchAt.current = null;
    const root = listRef.current;
    if (root !== null) {
      cancelPaint(root, registry.current);
    }
    if (restTimer.current !== null) {
      window.clearTimeout(restTimer.current);
      restTimer.current = null;
    }
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
  }, [generation, listRef]);

  const measureVisible = useCallback((root: HTMLElement): void => {
    const list = virtualizerRef.current;
    const userScrolling = scrollingRef.current;
    const nodes = root.querySelectorAll<HTMLElement>(".result-virtual-row");
    for (const node of nodes) {
      // A size change above the fold writes scrollTop, which sets
      // isScrolling and would skip the rest of this pass.
      if (!userScrolling) {
        list.isScrolling = false;
      }
      list.measureElement(node);
      const hit = node.querySelector<HTMLElement>("[data-hit-index]");
      if (hit === null || hit.classList.contains("is-open")) {
        continue;
      }
      const virtualIndex = Number(node.getAttribute("data-index"));
      const size = measuredRows(list)[virtualIndex]?.size;
      const hitIndex = Number(hit.dataset.hitIndex);
      if (size !== undefined && size > 0 && Number.isInteger(hitIndex)) {
        closedSizeRef.current.set(hitIndex, size);
        const guess = closedGuess.current;
        if (hit.querySelector(".result-lenchip") !== null) {
          if (guess.chip === 0) {
            guess.chip = size;
          }
        } else if (guess.plain === 0) {
          guess.plain = size;
        }
      }
    }
    if (!userScrolling) {
      list.isScrolling = false;
    }
  }, []);

  const totalSize = virtualizer.getTotalSize();

  const applyCapturedPin = useCallback((root: HTMLElement): void => {
    const pin = pinRef.current;
    if (pin === null || pinSettled.current) {
      return;
    }
    const el = root.querySelector<HTMLElement>(
      `[data-hit-index="${pin.index}"]`,
    );
    // Stable key left the row set (its group was folded). Do not pin.
    if (el === null || hitExpandKey(pin.index) !== pin.key) {
      pinSettled.current = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) {
      pinSettled.current = true;
      return;
    }
    const written = writtenTranslateY(el);
    const virtualIndex = lookupRef.current(pin.index);
    const start =
      virtualIndex < 0
        ? undefined
        : measuredRows(virtualizerRef.current)[virtualIndex]?.start;
    // The cache already has the next translateY. Reading the rect again
    // after scrolling would apply that shift twice.
    const stale =
      start !== undefined &&
      written !== null &&
      Math.abs(start - written) > PIN_SLOP_PX;
    let visual = pendingAnchorTop(el, virtualizerRef.current, virtualIndex);
    for (let pass = 0; pass < 4; pass += 1) {
      const delta = visual - pin.top;
      if (Math.abs(delta) <= PIN_SLOP_PX) {
        pinSettled.current = true;
        return;
      }
      const before = root.scrollTop;
      const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
      // One correction for this layout pass. Not a per-frame nudge.
      const applied = absorbAnchorShift(before, delta, maxScroll);
      if (applied === 0) {
        pinSettled.current = true;
        return;
      }
      ignoreScroll.current += 1;
      root.scrollTop = before + applied;
      if (root.scrollTop === before || stale) {
        if (root.scrollTop === before) {
          ignoreScroll.current = Math.max(0, ignoreScroll.current - 1);
        }
        pinSettled.current = true;
        return;
      }
      visual = el.getBoundingClientRect().top;
      if (Math.abs(visual - pin.top) >= Math.abs(delta) - 0.05) {
        pinSettled.current = true;
        return;
      }
    }
    pinSettled.current = true;
  }, []);

  useLayoutEffect(() => {
    const root = listRef.current;
    const restoreNotify =
      parkedSilence.current ?? silenceVirtualizer(virtualizerRef.current);
    parkedSilence.current = null;
    silenceHeld.current = true;
    let handoff = false;
    let armedScroll = false;
    try {
      if (root === null) {
        return;
      }
      if (appliedCut.current !== motionCut) {
        appliedCut.current = motionCut;
        cancelPaint(root, registry.current);
        pendingPlay.current = null;
        skipMeasure.current = false;
      }
      if (skipMeasure.current) {
        skipMeasure.current = false;
        adjusting.current = true;
        try {
          // Cancel finished fills before the read so that invalidation is
          // flushed by the measure, not by the next frame.
          for (const rowEl of root.querySelectorAll<HTMLElement>(
            ".result-virtual-row",
          )) {
            registry.current.dropFinished(rowEl);
          }
          // The held row just swapped back to its closed content. Measure
          // that height while notify is still parked, or the resize observer
          // schedules another commit when the cache catches up.
          measureVisible(root);
          writeVirtualPositions(root, virtualizerRef.current);
        } finally {
          adjusting.current = false;
        }
        return;
      }
      adjusting.current = true;
      try {
      const pending = pendingPlay.current;
      if (pending !== null && !pending.played) {
        pending.played = true;
        const applied = pending.applied;
        // Write the scroll correction before any geometry read. The following
        // measure then sees one layout, and later effects must not read again.
        root.dataset.motionPin = "1";
        let scrollDelta = 0;
        if (applied !== 0) {
          const next = pending.scrollBefore + applied;
          if (next !== pending.scrollBefore) {
            ignoreScroll.current += 1;
            commitScrollTopDom(root, virtualizerRef.current, next);
            const actual = root.scrollTop;
            if (actual === pending.scrollBefore) {
              ignoreScroll.current = Math.max(0, ignoreScroll.current - 1);
            } else {
              armedScroll = true;
              scrollDelta = actual - pending.scrollBefore;
            }
          }
        }
        if (!armedScroll) {
          queueMicrotask(() => {
            if (root.dataset.motionPin === "1") {
              delete root.dataset.motionPin;
            }
          });
        }
        measureVisible(root);
        const live = readMotionRows(root);
        pinSettled.current = true;
        const releaseGenAtStart = releaseGen.current;
        const releaseHolds = (): void => {
          if (releaseGenAtStart !== releaseGen.current) {
            return;
          }
          if (holdsRef.current.length === 0) {
            return;
          }
          // Keep the notify parked through the commit that drops the hold.
          parkSilence();
          handoff = true;
          skipMeasure.current = true;
          const top = root.scrollTop;
          holdsRef.current = [];
          commitScrollRef.current(top);
          setHoldsTracked([]);
        };
        let duringStart = true;
        let releaseAfterScroll = false;
        startSwitchMotion({
          root,
          registry: registry.current,
          capture: pending.capture,
          opening: pending.opening,
          closing: pending.closing,
          anchorStart: pending.anchorStart,
          scrollDelta,
          scrollApplied: 0,
          liveRows: live,
          pendingStart: (rowEl) => {
            const index = Number(rowEl.dataset.index);
            if (!Number.isInteger(index) || index < 0) {
              return undefined;
            }
            return measuredRows(virtualizerRef.current)[index]?.start;
          },
          onCollapseSettled: () => {
            if (duringStart) {
              releaseAfterScroll = true;
              return;
            }
            releaseHolds();
          },
        });
        duringStart = false;
        writeVirtualPositions(root, virtualizerRef.current);
        if (releaseAfterScroll) {
          releaseHolds();
        }
      } else {
        measureVisible(root);
        applyCapturedPin(root);
        writeVirtualPositions(root, virtualizerRef.current);
      }
      for (const rowEl of root.querySelectorAll<HTMLElement>(
        ".result-virtual-row",
      )) {
        registry.current.dropFinished(rowEl);
      }
      } finally {
        adjusting.current = false;
      }
    } finally {
      if (handoff) {
        parkedSilence.current = restoreNotify;
      } else {
        restoreNotify();
        silenceHeld.current = false;
        if (armedScroll && root !== null) {
          const host = virtualizerRef.current as VirtualizerHost;
          // restoreNotify clears isScrolling. The scroll event is still
          // queued and only bails while this flag is set.
          host.isScrolling = true;
          const real = host.options.onChange;
          const guard = scrollGuard.current + 1;
          scrollGuard.current = guard;
          const wrapped = (): void => {
            if (scrollGuard.current === guard) {
              return;
            }
            real?.(host, false);
          };
          host.options.onChange = wrapped;
          window.setTimeout(() => {
            if (scrollGuard.current !== guard) {
              return;
            }
            releasePinnedScroll(listRef.current, virtualizerRef.current);
            if (host.options.onChange === wrapped) {
              host.options.onChange = real;
            }
            scrollGuard.current = 0;
          }, 0);
        }
      }
    }
  }, [
    applyCapturedPin,
    holds,
    layoutEpoch,
    listRef,
    measureTick,
    motionCut,
    measureVisible,
    model,
    parkSilence,
    setHoldsTracked,
    totalSize,
  ]);

  const prepareStructurePin = useCallback(() => {
    assignPin(
      pinRef,
      pinSettled,
      listRef.current,
      releaseAnchorIndex(listRef.current, lastPointerIndex.current),
    );
    structurePin.current = !pinSettled.current;
  }, [listRef]);

  const settleStructurePin = useCallback(() => {
    if (!structurePin.current) {
      return;
    }
    const root = listRef.current;
    adjusting.current = true;
    structurePin.current = false;
    try {
      if (root === null || pinRef.current === null) {
        return;
      }
      // Sort selects the new first line and scrollToIndex runs after the
      // layout pin. Re-apply against the same captured top.
      pinSettled.current = false;
      measureVisible(root);
      applyCapturedPin(root);
    } finally {
      adjusting.current = false;
    }
  }, [applyCapturedPin, listRef, measureVisible]);

  useLayoutEffect(() => {
    const root = listRef.current;
    const probe = root?.querySelector<HTMLElement>(".result-log");
    if (probe !== undefined && probe !== null) {
      warmMotionColors(probe);
    }
  }, [generation, listRef]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (scrollingRef.current || holdsRef.current.length > 0) {
        return;
      }
      const since = lastSwitchAt.current;
      if (since !== null && performance.now() - since < 500) {
        return;
      }
      const live = listRef.current;
      const probe = live?.querySelector<HTMLElement>(".result-log");
      if (live === null || probe === undefined || probe === null) {
        return;
      }
      warmOpenHeights(live, probe.getBoundingClientRect().width, openSizeRef.current);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [generation, listRef, totalSize]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media === undefined) {
      return;
    }
    const apply = (): void => {
      reducedRef.current = media.matches;
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const root = listRef.current;
    if (root === null) {
      return;
    }
    const shell = root.parentElement ?? root;

    const clearRest = (): void => {
      if (restTimer.current !== null) {
        window.clearTimeout(restTimer.current);
        restTimer.current = null;
      }
    };

    const indexUnderPointer = (): number | null => {
      const pointer = pointerRef.current;
      const fromPoint =
        typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(pointer.x, pointer.y)
          : null;
      if (fromPoint instanceof Element) {
        if (shell.contains(fromPoint)) {
          return indexFromElement(fromPoint);
        }
        return null;
      }
      return pointer.index;
    };

    const commitRest = (): void => {
      restTimer.current = null;
      if (pointerRestBlocked(scrollingRef.current, pointerRef.current.inside)) {
        return;
      }
      const index = indexUnderPointer();
      pointerRef.current.index = index;
      // Sticky header and other list chrome are not a hit. Leaving the row
      // for that chrome must not collapse the open row.
      if (index === null) {
        return;
      }
      const truncated = truncRef.current.get(index) === true;
      const nextActive: RowOpen | null = truncated
        ? { index, source: "pointer" }
        : null;
      commitModel({ active: nextActive }, index);
    };

    const scheduleRest = (): void => {
      clearRest();
      if (pointerRestBlocked(scrollingRef.current, pointerRef.current.inside)) {
        return;
      }
      restTimer.current = window.setTimeout(commitRest, HOVER_REST_MS);
    };

    const onPointerMove = (event: PointerEvent): void => {
      pointerRef.current.x = event.clientX;
      pointerRef.current.y = event.clientY;
      pointerRef.current.inside = true;
      const index =
        event.target instanceof Element ? indexFromElement(event.target) : null;
      pointerRef.current.index = index;
      if (index !== null) {
        lastPointerIndex.current = index;
      }
      if (pointerRestBlocked(scrollingRef.current, true)) {
        return;
      }
      if (index === null) {
        clearRest();
        return;
      }
      scheduleRest();
    };

    const onPointerLeave = (event: PointerEvent): void => {
      const next = event.relatedTarget;
      if (next instanceof Node && shell.contains(next)) {
        return;
      }
      pointerRef.current.inside = false;
      pointerRef.current.index = null;
      clearRest();
      const current = modelRef.current;
      const keep =
        current.active?.source === "keyboard" ? current.active : null;
      // The pointer has left the list, so it is not resting on a row. Pin the
      // last in-view pointer hit (else the first visible hit) by stable key
      // when scrollTop can absorb the shift; otherwise collapse anyway.
      const anchor = releaseAnchorIndex(root, lastPointerIndex.current);
      commitModel({ active: keep }, anchor);
    };

    const onScroll = (): void => {
      // Programmatic pin. Reading geometry here, or warming heights, is a layout.
      if (root.dataset.motionPin === "1") {
        if (ignoreScroll.current > 0) {
          ignoreScroll.current -= 1;
        }
        return;
      }
      if (adjusting.current || structurePin.current) {
        if (ignoreScroll.current > 0) {
          ignoreScroll.current -= 1;
        }
        return;
      }
      if (ignoreScroll.current > 0) {
        ignoreScroll.current -= 1;
        return;
      }
      scrollingRef.current = true;
      pinRef.current = null;
      pinSettled.current = true;
      clearRest();
      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
      }
      scrollTimer.current = window.setTimeout(() => {
        scrollTimer.current = null;
        scrollingRef.current = false;
        const live = listRef.current;
        const probe = live?.querySelector<HTMLElement>(".result-log");
        if (live !== null && probe !== undefined && probe !== null) {
          const width = probe.getBoundingClientRect().width;
          warmOpenHeights(live, width, openSizeRef.current);
        }
        scheduleRest();
      }, SCROLL_IDLE_MS);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPlainListNav(event)) {
        return;
      }
      keyNav.current = true;
      keyRepeat.current = event.repeat;
      const mark = keyNavGen.current + 1;
      keyNavGen.current = mark;
      window.setTimeout(() => {
        if (keyNavGen.current === mark) {
          keyNav.current = false;
        }
      }, 0);
    };

    const onClick = (): void => {
      keyNav.current = false;
      keyNavGen.current += 1;
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("click", onClick, true);
    shell.addEventListener("pointermove", onPointerMove);
    shell.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("click", onClick, true);
      shell.removeEventListener("pointermove", onPointerMove);
      shell.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("scroll", onScroll);
      clearRest();
      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = null;
      }
    };
  }, [commitModel, listRef]);

  const openIndexes = useMemo(() => {
    return new Set(openHitIndexes(model));
  }, [model]);

  return {
    openIndexes,
    holdHeights: holds,
    reportTruncation,
    settleStructurePin,
    prepareStructurePin,
  };
}
