import type { Virtualizer } from "@tanstack/react-virtual";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** Pointer must sit still this long before a row opens or closes. */
export const HOVER_REST_MS = 150;
/** Scroll events inside this window suppress hover changes. */
export const SCROLL_IDLE_MS = 150;

export type RowOpen = { index: number; source: "pointer" | "keyboard" };

type ListVirtualizer = Virtualizer<HTMLDivElement, Element>;

const PIN_SLOP_PX = 1;

function indexFromElement(node: Element): number | null {
  const row = node.closest("[data-hit-index]");
  if (row === null) {
    return null;
  }
  const value = Number(row.getAttribute("data-hit-index"));
  return Number.isInteger(value) ? value : null;
}

function anchorTop(
  root: HTMLElement,
  virtualizer: ListVirtualizer,
  virtualIndex: number,
): number | null {
  if (virtualIndex < 0) {
    return null;
  }
  const inner = root.querySelector<HTMLElement>(".result-list-inner");
  if (inner === null) {
    return null;
  }
  const visible = virtualizer
    .getVirtualItems()
    .find((item) => item.index === virtualIndex);
  const start =
    visible?.start ?? virtualizer.measurementsCache[virtualIndex]?.start;
  if (start === undefined) {
    return null;
  }
  // translateY(start) lands on the next commit; the cache is already updated,
  // so the row's viewport top is the inner box plus that start.
  return inner.getBoundingClientRect().top + start;
}

/**
 * One hover timer for the whole list (event delegation). Opens a truncated
 * row after the pointer rests, and shifts scrollTop so that row's top edge
 * stays put when a neighbor's height changes.
 */
export function useResultExpand(opts: {
  listRef: RefObject<HTMLDivElement | null>;
  listNavRef?: RefObject<(index: number) => void> | undefined;
  virtualizer: ListVirtualizer;
  hitVirtualIndex: (hitIndex: number) => number;
  /** Hit identity. A new search (different first hit) drops open state. */
  hits: readonly unknown[];
}): {
  open: RowOpen | null;
  reportTruncation: (index: number, truncated: boolean) => void;
} {
  const { listRef, listNavRef, virtualizer, hitVirtualIndex, hits } = opts;
  const [open, setOpenState] = useState<RowOpen | null>(null);
  const [measureTick, setMeasureTick] = useState(0);
  const openRef = useRef<RowOpen | null>(null);
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
  const truncGen = useRef(0);
  const seriesHead = hits.length === 0 ? null : hits[0];
  const [trackedHead, setTrackedHead] = useState<unknown>(seriesHead);
  const [generation, setGeneration] = useState(0);
  if (trackedHead !== seriesHead) {
    setTrackedHead(seriesHead);
    setGeneration((value) => value + 1);
    setOpenState(null);
  } else if (open !== null && open.index >= hits.length) {
    setOpenState(null);
  }

  const setOpen = useCallback((next: RowOpen | null) => {
    const prev = openRef.current;
    if (
      prev === next ||
      (prev !== null &&
        next !== null &&
        prev.index === next.index &&
        prev.source === next.source)
    ) {
      openRef.current = next;
      return;
    }
    openRef.current = next;
    setOpenState(next);
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
      capturePin(index);
      setOpen({ index, source: "keyboard" });
    },
    [capturePin, generation, setOpen],
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
        capturePin(index);
        setOpen({ index, source: "keyboard" });
        return;
      }
      if (known === false) {
        pendingKey.current = null;
        if (openRef.current === null) {
          return;
        }
        capturePin(index);
        setOpen(null);
        return;
      }
      pendingKey.current = index;
      if (openRef.current !== null) {
        capturePin(openRef.current.index);
        setOpen(null);
      }
    },
    [capturePin, generation, setOpen],
  );

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer;
    lookupRef.current = hitVirtualIndex;
  });

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    if (listNavRef) {
      listNavRef.current = onKeyboardNav;
    }
  }, [listNavRef, onKeyboardNav]);

  useLayoutEffect(() => {
    pendingKey.current = null;
    pinRef.current = null;
    pinSettled.current = true;
    pointerRef.current.index = null;
    scrollingRef.current = false;
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
    }
    if (!userScrolling) {
      list.isScrolling = false;
    }
  }, []);

  useLayoutEffect(() => {
    const root = listRef.current;
    if (root === null) {
      return;
    }
    const pin = pinRef.current;
    const passes = pin !== null && !pinSettled.current ? 2 : 1;
    for (let pass = 0; pass < passes; pass += 1) {
      adjusting.current = true;
      try {
        measureVisible(root);
        if (pin === null || pinSettled.current) {
          return;
        }
        const top = anchorTop(
          root,
          virtualizerRef.current,
          lookupRef.current(pin.index),
        );
        if (top === null) {
          pinSettled.current = true;
          return;
        }
        const delta = top - pin.top;
        if (Math.abs(delta) <= PIN_SLOP_PX) {
          pinSettled.current = true;
          return;
        }
        const before = root.scrollTop;
        ignoreScroll.current += 1;
        root.scrollTop = before + delta;
        if (root.scrollTop === before) {
          ignoreScroll.current = Math.max(0, ignoreScroll.current - 1);
          pinSettled.current = true;
          return;
        }
      } finally {
        adjusting.current = false;
      }
    }
  }, [listRef, measureTick, measureVisible, open]);

  useEffect(() => {
    const root = listRef.current;
    if (root === null) {
      return;
    }

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
        if (root.contains(fromPoint)) {
          return indexFromElement(fromPoint);
        }
        const rect = root.getBoundingClientRect();
        const overList =
          pointer.x >= rect.left &&
          pointer.x <= rect.right &&
          pointer.y >= rect.top &&
          pointer.y <= rect.bottom;
        if (overList) {
          return pointer.index;
        }
        return null;
      }
      return pointer.index;
    };

    const commitRest = (): void => {
      restTimer.current = null;
      if (scrollingRef.current || !pointerRef.current.inside) {
        return;
      }
      const index = indexUnderPointer();
      pointerRef.current.index = index;
      const truncated = index !== null && truncRef.current.get(index) === true;
      if (index === null || !truncated) {
        if (openRef.current === null) {
          return;
        }
        capturePin(index);
        setOpen(null);
        return;
      }
      if (
        openRef.current?.source === "pointer" &&
        openRef.current.index === index
      ) {
        return;
      }
      capturePin(index);
      setOpen({ index, source: "pointer" });
    };

    const scheduleRest = (): void => {
      clearRest();
      if (scrollingRef.current || !pointerRef.current.inside) {
        return;
      }
      restTimer.current = window.setTimeout(commitRest, HOVER_REST_MS);
    };

    const onPointerMove = (event: PointerEvent): void => {
      pointerRef.current.x = event.clientX;
      pointerRef.current.y = event.clientY;
      pointerRef.current.inside = true;
      pointerRef.current.index =
        event.target instanceof Element ? indexFromElement(event.target) : null;
      if (scrollingRef.current) {
        return;
      }
      scheduleRest();
    };

    const onPointerLeave = (): void => {
      pointerRef.current.inside = false;
      pointerRef.current.index = null;
      clearRest();
      if (openRef.current?.source !== "pointer") {
        return;
      }
      capturePin(openRef.current.index);
      setOpen(null);
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
        scheduleRest();
      }, SCROLL_IDLE_MS);
    };

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("scroll", onScroll);
      clearRest();
      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = null;
      }
    };
  }, [capturePin, listRef, setOpen]);

  return { open, reportTruncation };
}
