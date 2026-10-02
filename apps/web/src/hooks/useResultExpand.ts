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
  decideRetainedRows,
  PIN_SLOP_PX,
  pointerRestBlocked,
  type OpenRowLayout,
} from "../resultExpandPlan.ts";

/** Pointer must sit still this long before a row opens or closes. */
export const HOVER_REST_MS = 150;
/** Scroll events inside this window suppress hover changes. */
export const SCROLL_IDLE_MS = 150;

export type RowOpen = { index: number; source: "pointer" | "keyboard" };

type ListVirtualizer = Virtualizer<HTMLDivElement, Element>;

type RowMeasure = { start: number; size: number };

/** Full measurement cache. The public virtual-item list is only the window. */
function measuredRows(virtualizer: ListVirtualizer): readonly (RowMeasure | undefined)[] {
  const cache = virtualizer as unknown as {
    getMeasurements(): readonly (RowMeasure | undefined)[];
  };
  return cache.getMeasurements();
}

type ExpandModel = {
  /** The row the pointer or the keyboard currently wants open. */
  active: RowOpen | null;
  /** Extra rows kept open because collapsing them would jump the anchor. */
  retained: number[];
};

const EMPTY_MODEL: ExpandModel = { active: null, retained: [] };

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

function sameModel(a: ExpandModel, b: ExpandModel): boolean {
  if (a.active?.index !== b.active?.index || a.active?.source !== b.active?.source) {
    return false;
  }
  if (a.retained.length !== b.retained.length) {
    return false;
  }
  for (let i = 0; i < a.retained.length; i += 1) {
    if (a.retained[i] !== b.retained[i]) {
      return false;
    }
  }
  return true;
}

function openHitIndexes(model: ExpandModel): number[] {
  const indexes = new Set(model.retained);
  if (model.active !== null) {
    indexes.add(model.active.index);
  }
  return [...indexes];
}

function clampModel(model: ExpandModel, hitCount: number): ExpandModel {
  const active =
    model.active !== null && model.active.index < hitCount ? model.active : null;
  const retained = model.retained.filter(
    (index) => index < hitCount && index !== active?.index,
  );
  return { active, retained };
}

/**
 * One hover timer for the whole list (event delegation). Opens a truncated
 * row after the pointer rests. Collapsing a row above the anchor is skipped
 * when scrollTop cannot absorb the upward shift, so the anchor's top edge
 * stays put. Keyboard j/k is observed on the window and never computes the
 * next index itself.
 */
export function useResultExpand(opts: {
  listRef: RefObject<HTMLDivElement | null>;
  virtualizer: ListVirtualizer;
  hitVirtualIndex: (hitIndex: number) => number;
  /** Hit identity. A new search (different first hit) drops open state. */
  hits: readonly unknown[];
  /** Selection. A change is a keyboard expand only if a plain j/k/arrow just fired. */
  selectedIndex: number;
  /** Group fold / sort. Retained rows close when this changes. */
  structureKey: string;
}): {
  openIndexes: ReadonlySet<number>;
  reportTruncation: (index: number, truncated: boolean) => void;
} {
  const { listRef, virtualizer, hitVirtualIndex, hits, selectedIndex, structureKey } =
    opts;
  const [modelState, setModelState] = useState<ExpandModel>(EMPTY_MODEL);
  const [measureTick, setMeasureTick] = useState(0);
  const modelRef = useRef<ExpandModel>(EMPTY_MODEL);
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
  const pinRef = useRef<{ index: number; top: number } | null>(null);
  const pinSettled = useRef(true);
  const adjusting = useRef(false);
  const virtualizerRef = useRef(virtualizer);
  const lookupRef = useRef(hitVirtualIndex);
  const closedSizeRef = useRef(new Map<number, number>());
  const keyNav = useRef(false);
  const keyNavGen = useRef(0);
  const truncGen = useRef(0);
  const seriesHead = hits.length === 0 ? null : hits[0];
  const [trackedHead, setTrackedHead] = useState<unknown>(seriesHead);
  const [generation, setGeneration] = useState(0);
  const [trackedStructure, setTrackedStructure] = useState(structureKey);

  let model = modelState;
  if (trackedHead !== seriesHead) {
    setTrackedHead(seriesHead);
    setGeneration((value) => value + 1);
    model = EMPTY_MODEL;
    setModelState(model);
  } else if (trackedStructure !== structureKey) {
    setTrackedStructure(structureKey);
    if (model.retained.length > 0) {
      model = { active: model.active, retained: [] };
      setModelState(model);
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
    setModelState((prev) => (sameModel(prev, next) ? prev : next));
  }, []);

  const capturePin = useCallback(
    (index: number | null) => {
      const root = listRef.current;
      if (root === null || index === null) {
        pinRef.current = null;
        pinSettled.current = true;
        return;
      }
      const el = root.querySelector<HTMLElement>(`[data-hit-index="${index}"]`);
      if (el === null) {
        pinRef.current = null;
        pinSettled.current = true;
        return;
      }
      const rect = el.getBoundingClientRect();
      // jsdom has no layout box. Skip compensation rather than invent a delta.
      if (rect.height <= 0) {
        pinRef.current = null;
        pinSettled.current = true;
        return;
      }
      pinRef.current = { index, top: rect.top };
      pinSettled.current = false;
    },
    [listRef],
  );

  const measureHit = useCallback(
    (hitIndex: number): { start: number; size: number } | null => {
      const virtualIndex = lookupRef.current(hitIndex);
      if (virtualIndex < 0) {
        return null;
      }
      const item = measuredRows(virtualizerRef.current)[virtualIndex];
      if (item === undefined) {
        return null;
      }
      return { start: item.start, size: item.size };
    },
    [],
  );

  const planModel = useCallback(
    (
      nextActive: RowOpen | null,
      anchor: number | null,
      scrollTop: number,
    ): ExpandModel => {
      const closing = openHitIndexes(modelRef.current).filter(
        (index) => index !== nextActive?.index,
      );
      if (closing.length === 0 || anchor === null) {
        return { active: nextActive, retained: [] };
      }
      const anchorMeasure = measureHit(anchor);
      if (anchorMeasure === null) {
        return { active: nextActive, retained: closing };
      }
      const layouts: OpenRowLayout[] = [];
      for (const index of closing) {
        const measured = measureHit(index);
        if (measured === null) {
          layouts.push({
            index,
            start: anchorMeasure.start - 1,
            shrink: Number.POSITIVE_INFINITY,
          });
          continue;
        }
        const closed = closedSizeRef.current.get(index);
        const shrink =
          closed === undefined
            ? Number.POSITIVE_INFINITY
            : measured.size - closed;
        layouts.push({ index, start: measured.start, shrink });
      }
      const decision = decideRetainedRows(
        scrollTop,
        anchorMeasure.start,
        layouts,
      );
      return { active: nextActive, retained: decision.retain };
    },
    [measureHit],
  );

  const commitModel = useCallback(
    (next: ExpandModel, anchor: number | null) => {
      if (sameModel(modelRef.current, next)) {
        modelRef.current = next;
        return;
      }
      capturePin(anchor);
      setModel(next);
    },
    [capturePin, setModel],
  );

  const reportTruncation = useCallback(
    (index: number, truncated: boolean) => {
      if (truncGen.current !== generation) {
        truncRef.current.clear();
        truncGen.current = generation;
        pendingKey.current = null;
      }
      const prev = truncRef.current.get(index);
      truncRef.current.set(index, truncated);
      // Parent remeasures once per flip so the long-line chip is in the
      // virtualizer cache before paint. Same-value reports stay local.
      if (prev !== truncated && (truncated || prev === true)) {
        setMeasureTick((tick) => tick + 1);
      }
      if (pendingKey.current !== index) {
        return;
      }
      pendingKey.current = null;
      if (!truncated) {
        return;
      }
      const root = listRef.current;
      commitModel(
        planModel(
          { index, source: "keyboard" },
          index,
          root?.scrollTop ?? 0,
        ),
        index,
      );
    },
    [commitModel, generation, listRef, planModel],
  );

  const onKeyboardNav = useCallback(
    (index: number) => {
      if (truncGen.current !== generation) {
        truncRef.current.clear();
        truncGen.current = generation;
        pendingKey.current = null;
      }
      const known = truncRef.current.get(index);
      const root = listRef.current;
      const scrollTop = root?.scrollTop ?? 0;
      if (known === true) {
        pendingKey.current = null;
        commitModel(
          planModel({ index, source: "keyboard" }, index, scrollTop),
          index,
        );
        return;
      }
      if (known === false) {
        pendingKey.current = null;
        commitModel(planModel(null, index, scrollTop), index);
        return;
      }
      pendingKey.current = index;
      commitModel(planModel(null, index, scrollTop), index);
    },
    [commitModel, generation, listRef, planModel],
  );
  const onKeyboardNavRef = useRef(onKeyboardNav);

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer;
    lookupRef.current = hitVirtualIndex;
  });

  useLayoutEffect(() => {
    modelRef.current = model;
    onKeyboardNavRef.current = onKeyboardNav;
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
    scrollingRef.current = false;
    closedSizeRef.current.clear();
    if (restTimer.current !== null) {
      window.clearTimeout(restTimer.current);
      restTimer.current = null;
    }
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
  }, [generation]);

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
      }
    }
    if (!userScrolling) {
      list.isScrolling = false;
    }
  }, []);

  const totalSize = virtualizer.getTotalSize();

  useLayoutEffect(() => {
    const root = listRef.current;
    if (root === null) {
      return;
    }
    adjusting.current = true;
    try {
      measureVisible(root);
      const pin = pinRef.current;
      if (pin === null || pinSettled.current) {
        return;
      }
      const el = root.querySelector<HTMLElement>(
        `[data-hit-index="${pin.index}"]`,
      );
      if (el === null) {
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
        ignoreScroll.current += 1;
        root.scrollTop = before + delta;
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
    } finally {
      adjusting.current = false;
    }
  }, [listRef, measureTick, measureVisible, model, totalSize]);

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
      commitModel(
        planModel(nextActive, index, root.scrollTop),
        index,
      );
    };

    const scheduleRest = (): void => {
      clearRest();
      if (pointerRestBlocked(scrollingRef.current, pointerRef.current.inside)) {
        return;
      }
      restTimer.current = window.setTimeout(commitRest, HOVER_REST_MS);
    };

    const releaseRetained = (): void => {
      const current = modelRef.current;
      if (current.retained.length === 0) {
        return;
      }
      const anchor = pointerRef.current.inside
        ? (pointerRef.current.index ?? current.active?.index ?? null)
        : (current.active?.index ?? null);
      commitModel(planModel(current.active, anchor, root.scrollTop), anchor);
    };

    const onPointerMove = (event: PointerEvent): void => {
      pointerRef.current.x = event.clientX;
      pointerRef.current.y = event.clientY;
      pointerRef.current.inside = true;
      const index =
        event.target instanceof Element ? indexFromElement(event.target) : null;
      pointerRef.current.index = index;
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
      const keep = current.active?.source === "keyboard" ? current.active : null;
      commitModel({ active: keep, retained: [] }, keep?.index ?? null);
    };

    const onScroll = (): void => {
      if (adjusting.current) {
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
        releaseRetained();
        scheduleRest();
      }, SCROLL_IDLE_MS);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPlainListNav(event)) {
        return;
      }
      keyNav.current = true;
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
  }, [commitModel, listRef, planModel]);

  const openIndexes = useMemo(() => {
    return new Set(openHitIndexes(model));
  }, [model]);

  return { openIndexes, reportTruncation };
}
