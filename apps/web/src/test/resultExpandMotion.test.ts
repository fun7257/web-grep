/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnimLike,
  affectedKeys,
  translatePlan,
  COLLAPSE_EASE,
  COLLAPSE_MS,
  clipRange,
  clipVisualHeight,
  collapseHeadDiffers,
  EXPAND_EASE,
  EXPAND_MS,
  type HeightCause,
  MotionRegistry,
  parseClipBottom,
  planTranslatePieces,
  rememberClip,
  sampleEasing,
  predictScrollDelta,
  readMotionRows,
  shouldAnimateMotion,
  snapshotForSwitch,
  startSwitchMotion,
  visualHeight,
} from "../resultExpandMotion.ts";

describe("shouldAnimateMotion", () => {
  const base = {
    reducedMotion: false,
    scrolling: false,
    keyRepeat: false,
    sinceLastMs: null as number | null,
    waapi: true,
  };

  it("plays only when nothing blocks it", () => {
    expect(shouldAnimateMotion(base)).toBe(true);
    expect(shouldAnimateMotion({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldAnimateMotion({ ...base, scrolling: true })).toBe(false);
    expect(shouldAnimateMotion({ ...base, keyRepeat: true })).toBe(false);
    expect(shouldAnimateMotion({ ...base, waapi: false })).toBe(false);
    expect(shouldAnimateMotion({ ...base, sinceLastMs: 119 })).toBe(false);
    expect(shouldAnimateMotion({ ...base, sinceLastMs: 120 })).toBe(true);
  });
});

describe("clip range", () => {
  it("hides the new tail while a row grows and reveals overflow while it shrinks", () => {
    expect(clipRange(240, 50)).toEqual({
      from: "inset(0px 0px 190px 0px)",
      to: "inset(0px 0px 0px 0px)",
    });
    expect(clipRange(50, 240)).toEqual({
      from: "inset(0px 0px -190px 0px)",
      to: "inset(0px 0px 0px 0px)",
    });
    expect(clipRange(100, 100)).toBeNull();
    expect(clipRange(100, 100.4)).toBeNull();
  });

  it("reads the visible height from the bottom inset", () => {
    expect(parseClipBottom("inset(0px 0px 40px 0px)")).toBe(40);
    expect(parseClipBottom("inset(0px 0px -12.5px 0px)")).toBe(-12.5);
    expect(parseClipBottom("inset(0px)")).toBe(0);
    expect(parseClipBottom("inset(-8px)")).toBe(-8);
    expect(parseClipBottom("inset(12px 4px)")).toBe(12);
    expect(parseClipBottom("inset(0px 0px -418.047px)")).toBe(-418.047);
    expect(parseClipBottom("inset(1px 2px 3.5px 4px)")).toBe(3.5);
    expect(parseClipBottom("inset(0px 0px -12px 0px round 4px)")).toBe(-12);
    expect(parseClipBottom("inset(6px round 2px 4px)")).toBe(6);
    expect(parseClipBottom("inset(0px 0px -418.047px)")).toBe(-418.047);
    expect(visualHeight(76, parseClipBottom("inset(0px 0px -418.047px)"))).toBeCloseTo(
      494.047,
      3,
    );
    expect(parseClipBottom("none")).toBeNull();
    expect(parseClipBottom("inset(10%)")).toBeNull();
    expect(visualHeight(50, -190)).toBe(240);
    expect(visualHeight(240, 190)).toBe(50);
    expect(visualHeight(80, null)).toBe(80);
  });
});

describe("planTranslatePieces", () => {
  const collapse = (start: number, delta: number): HeightCause => ({
    start,
    layoutDelta: delta,
    opening: false,
  });
  const expand = (start: number, delta: number): HeightCause => ({
    start,
    layoutDelta: delta,
    opening: true,
  });

  it("keeps an anchor still when scroll absorbs a collapse above it", () => {
    expect(planTranslatePieces(0, 200, 200, [collapse(0, -150)], -150)).toEqual(
      [],
    );
  });

  it("slides rows below a collapse when scroll stays put", () => {
    expect(planTranslatePieces(150, 400, 200, [collapse(0, -150)], 0)).toEqual([
      { fromY: 150, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
    expect(planTranslatePieces(0, 0, 200, [collapse(0, -150)], 0)).toEqual([]);
  });

  it("does not counter-translate a row that only the scroll moved", () => {
    expect(planTranslatePieces(0, 0, 300, [collapse(100, -150)], -150)).toEqual(
      [],
    );
  });

  it("splits a simultaneous collapse and expand onto their own easings", () => {
    const causes = [collapse(0, -150), expand(200, 150)];
    const below = planTranslatePieces(-150, 500, 200, causes, -150);
    expect(below).toEqual([
      { fromY: -150, duration: EXPAND_MS, easing: EXPAND_EASE },
    ]);
    const anchor = planTranslatePieces(0, 200, 200, causes, -150);
    expect(anchor).toEqual([]);
    // The expand piece shares the opening ease, so the row below stays on
    // the opening row's growing edge. The absorbed collapse contributes 0.
    expect(below[0]?.duration).toBe(EXPAND_MS);
  });

  it("keeps an unfinished visual offset as its own piece", () => {
    const pieces = planTranslatePieces(162, 400, 200, [collapse(0, -150)], 0);
    expect(pieces.map((piece) => piece.fromY)).toEqual([150, 12]);
  });

  it("slides the anchor by the part scroll could not absorb", () => {
    const pieces = planTranslatePieces(140, 200, 200, [collapse(0, -150)], -10);
    expect(pieces).toEqual([
      { fromY: 140, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
  });
});

describe("predictScrollDelta and affectedKeys", () => {
  it("clamps the anchor shift into the scroll range", () => {
    expect(
      predictScrollDelta(0, 500, 200, [
        { hitIndex: 0, docStart: 0, layoutDelta: -150 },
      ]),
    ).toBe(0);
    expect(
      predictScrollDelta(10, 500, 200, [
        { hitIndex: 0, docStart: 0, layoutDelta: -150 },
      ]),
    ).toBe(-10);
    expect(
      predictScrollDelta(200, 500, 200, [
        { hitIndex: 0, docStart: 0, layoutDelta: -150 },
      ]),
    ).toBe(-150);
  });

  it("retargets every visible row, including ones above the change", () => {
    const rows = [
      { key: "h", docStart: 0, hitIndex: null },
      { key: "a", docStart: 36, hitIndex: 0 },
      { key: "b", docStart: 200, hitIndex: 1 },
    ];
    const keys = affectedKeys(rows, [{ hitIndex: 0, docStart: 36 }], false);
    expect([...keys].sort()).toEqual(["a", "b", "h"]);
    expect(affectedKeys(rows, [{ hitIndex: 0, docStart: 36 }], true).size).toBe(
      3,
    );
    expect(affectedKeys(rows, [], false).size).toBe(0);
  });
});

describe("translatePlan", () => {
  const collapse = (start: number, delta: number): HeightCause => ({
    start,
    layoutDelta: delta,
    opening: false,
  });
  const expand = (start: number, delta: number): HeightCause => ({
    start,
    layoutDelta: delta,
    opening: true,
  });

  it("keeps a closing row and the rows above a collapse on the collapse clock", () => {
    const causes = [collapse(0, -479), expand(500, 479)];
    expect(translatePlan(-479, 0, 500, causes, -479, "close")).toEqual([
      { fromY: -479, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
    expect(translatePlan(-479, 36, 500, causes, -479, "none")).toEqual([
      { fromY: -479, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
    expect(translatePlan(0.2, 0, 500, causes, 0, "none")).toEqual([]);
  });

  it("moves a closing row under an expand on the expand clock", () => {
    const causes = [expand(30, 460), collapse(70, -460)];
    expect(translatePlan(-460, 70, 30, causes, 0, "close")).toEqual([
      { fromY: -460, duration: EXPAND_MS, easing: EXPAND_EASE },
    ]);
    expect(translatePlan(0, 30, 30, causes, 0, "open")).toEqual([]);
  });

  it("still splits a row below an expand onto the expand clock", () => {
    const causes = [collapse(0, -150), expand(200, 150)];
    expect(translatePlan(-150, 500, 200, causes, -150, "none")).toEqual([
      { fromY: -150, duration: EXPAND_MS, easing: EXPAND_EASE },
    ]);
  });
});

describe("adjacent boxes stay seamed on both clocks", () => {
  type RowSpec = {
    index: number;
    start: number;
    height: number;
    nextHeight?: number;
  };

  function translateAt(
    pieces: { fromY: number; duration: number; easing: string }[],
    t: number,
  ): number {
    let y = 0;
    for (const piece of pieces) {
      const linear = piece.duration > 0 ? Math.min(1, t / piece.duration) : 1;
      y += piece.fromY * (1 - sampleEasing(piece.easing, linear));
    }
    return y;
  }

  function visualAt(row: {
    fromVis: number;
    finalHeight: number;
    own: "open" | "close" | "none";
  }, t: number): number {
    if (row.own === "none") {
      return row.finalHeight;
    }
    const duration = row.own === "open" ? EXPAND_MS : COLLAPSE_MS;
    const easing = row.own === "open" ? EXPAND_EASE : COLLAPSE_EASE;
    const eased = sampleEasing(easing, Math.min(1, t / duration));
    return row.fromVis + (row.finalHeight - row.fromVis) * eased;
  }

  function seam(
    rows: RowSpec[],
    opening: number | null,
    closing: number[],
    anchor: number,
    scrollTop: number,
  ): { maxOverlap: number; maxGap: number; anchorDrift: number } {
    const closingSet = new Set(closing);
    let cursor = 0;
    const placed = rows.map((row) => {
      const finalHeight =
        row.index === opening || closingSet.has(row.index)
          ? (row.nextHeight ?? row.height)
          : row.height;
      const placedRow = { ...row, finalStart: cursor, finalHeight };
      cursor += finalHeight;
      return placedRow;
    });
    const causes: HeightCause[] = [];
    for (const row of rows) {
      if (row.index === opening) {
        causes.push({
          start: row.start,
          layoutDelta: (row.nextHeight ?? row.height) - row.height,
          visualDelta: (row.nextHeight ?? row.height) - row.height,
          opening: true,
        });
      } else if (closingSet.has(row.index)) {
        causes.push({
          start: row.start,
          layoutDelta: (row.nextHeight ?? row.height) - row.height,
          visualDelta: (row.nextHeight ?? row.height) - row.height,
          opening: false,
        });
      }
    }
    const anchorRow = rows.find((row) => row.index === anchor);
    const anchorStart = anchorRow?.start ?? 0;
    const scroll = predictScrollDelta(
      scrollTop,
      8000,
      anchorStart,
      causes.map((cause) => ({
        hitIndex: 0,
        docStart: cause.start,
        layoutDelta: cause.layoutDelta,
      })),
    );
    const animated = placed.map((row) => {
      const own: "open" | "close" | "none" =
        row.index === opening ? "open" : closingSet.has(row.index) ? "close" : "none";
      const visualDy = row.start - (row.finalStart - scroll);
      return {
        ...row,
        own,
        fromVis: row.height,
        newTop: row.finalStart - scroll,
        pieces: translatePlan(visualDy, row.start, anchorStart, causes, scroll, own),
      };
    });
    let maxOverlap = 0;
    let maxGap = 0;
    const anchorAnim = animated.find((row) => row.index === anchor);
    const anchor0 = anchorAnim === undefined ? 0 : anchorAnim.newTop + translateAt(anchorAnim.pieces, 0);
    let anchorDrift = 0;
    for (let t = 0; t <= 320; t += 5) {
      if (anchorAnim !== undefined) {
        const top = anchorAnim.newTop + translateAt(anchorAnim.pieces, t);
        anchorDrift = Math.max(anchorDrift, Math.abs(top - anchor0));
      }
      for (let i = 0; i < animated.length - 1; i += 1) {
        const upper = animated[i];
        const lower = animated[i + 1];
        if (upper === undefined || lower === undefined) {
          continue;
        }
        const bottom = upper.newTop + translateAt(upper.pieces, t) + visualAt(upper, t);
        const top = lower.newTop + translateAt(lower.pieces, t);
        const gap = top - bottom;
        maxGap = Math.max(maxGap, gap);
        maxOverlap = Math.max(maxOverlap, -gap);
      }
    }
    return { maxOverlap, maxGap, anchorDrift };
  }

  it("stays within 1px switching up, down, across rows, and at scroll 0", () => {
    const stack: RowSpec[] = [
      { index: 0, start: 0, height: 28 },
      { index: 1, start: 28, height: 76, nextHeight: 520 },
      { index: 2, start: 104, height: 76 },
      { index: 3, start: 180, height: 76 },
      { index: 4, start: 256, height: 540, nextHeight: 76 },
      { index: 5, start: 796, height: 76 },
    ];
    const down: RowSpec[] = [
      { index: 0, start: 0, height: 28 },
      { index: 1, start: 28, height: 540, nextHeight: 76 },
      { index: 2, start: 568, height: 76, nextHeight: 500 },
      { index: 3, start: 644, height: 76 },
    ];
    const cases = [
      seam(stack, 1, [4], 1, 2000),
      seam(down, 2, [1], 2, 2000),
      seam(down, 2, [1], 2, 0),
      seam(
        [
          { index: 10, start: 0, height: 80, nextHeight: 400 },
          { index: 11, start: 80, height: 80 },
          { index: 12, start: 160, height: 420, nextHeight: 80 },
        ],
        10,
        [12],
        10,
        400,
      ),
    ];
    for (const item of cases) {
      expect(item.maxOverlap).toBeLessThanOrEqual(1);
      expect(item.maxGap).toBeLessThanOrEqual(1);
    }
    expect(cases[0]?.anchorDrift).toBeLessThanOrEqual(1);
    expect(cases[1]?.anchorDrift).toBeLessThanOrEqual(1);
  });

  it("stays seamed when a collapse retargets a mid-flight expand", () => {
    const causes: HeightCause[] = [
      { start: 0, layoutDelta: 424, visualDelta: 424, opening: true },
      { start: 76, layoutDelta: 76 - 500, visualDelta: 76 - 220, opening: false },
    ];
    const rows = [
      { start: 0, finalTop: 0, fromVis: 76, finalHeight: 500, own: "open" as const, visualDy: 0 },
      { start: 76, finalTop: 500, fromVis: 220, finalHeight: 76, own: "close" as const, visualDy: 76 - 500 },
      { start: 576, finalTop: 576, fromVis: 76, finalHeight: 76, own: "none" as const, visualDy: 296 - 576 },
    ];
    const animated = rows.map((row) => ({
      ...row,
      pieces: translatePlan(row.visualDy, row.start, 0, causes, 0, row.own),
    }));
    let maxOverlap = 0;
    let maxGap = 0;
    for (let t = 0; t <= 320; t += 5) {
      for (let i = 0; i < animated.length - 1; i += 1) {
        const upper = animated[i];
        const lower = animated[i + 1];
        if (upper === undefined || lower === undefined) {
          continue;
        }
        const bottom =
          upper.finalTop + translateAt(upper.pieces, t) + visualAt(upper, t);
        const top = lower.finalTop + translateAt(lower.pieces, t);
        const gap = top - bottom;
        maxGap = Math.max(maxGap, gap);
        maxOverlap = Math.max(maxOverlap, -gap);
      }
    }
    expect(maxOverlap).toBeLessThanOrEqual(1);
    expect(maxGap).toBeLessThanOrEqual(1);
  });
});

describe("clipVisualHeight", () => {
  it("reconstructs the visible height from eased progress without reading style", () => {
    const el = document.createElement("div");
    const anim = {
      cancel() {},
      onfinish: null,
      oncancel: null,
      playState: "running",
      effect: {
        getComputedTiming: () => ({ progress: 0.25 }),
      },
    };
    rememberClip(el, anim, 535, 76, COLLAPSE_MS, COLLAPSE_EASE);
    expect(clipVisualHeight(el)).toBeCloseTo(535 + (76 - 535) * 0.25, 5);
    anim.playState = "idle";
    expect(clipVisualHeight(el)).toBeNull();
  });

  it("applies the easing when only currentTime is available", () => {
    const el = document.createElement("div");
    const linear = 40 / EXPAND_MS;
    rememberClip(
      el,
      {
        cancel() {},
        onfinish: null,
        oncancel: null,
        playState: "running",
        currentTime: 40,
      },
      76,
      520,
      EXPAND_MS,
      EXPAND_EASE,
    );
    const expected = 76 + (520 - 76) * sampleEasing(EXPAND_EASE, linear);
    expect(clipVisualHeight(el)).toBeCloseTo(expected, 5);
  });
});

describe("collapseHeadDiffers", () => {
  it("is false within the 3000 character budget and true when the windows diverge", () => {
    expect(collapseHeadDiffers("short NEEDLE", [{ start: 6, end: 12 }])).toBe(
      false,
    );
    const text = `HEAD-${"a".repeat(4000)}NEEDLE${"b".repeat(80)}`;
    const at = text.indexOf("NEEDLE");
    expect(collapseHeadDiffers(text, [{ start: at, end: at + 6 }])).toBe(true);
    expect(collapseHeadDiffers("x".repeat(3001), [])).toBe(false);
  });
});

function fakeAnim(): AnimLike & { finish: () => void; cancelCalls: number } {
  const anim = {
    onfinish: null as (() => void) | null,
    oncancel: null as (() => void) | null,
    playState: "running",
    cancelCalls: 0,
    cancel() {
      this.cancelCalls += 1;
      this.playState = "idle";
    },
    finish() {
      this.playState = "finished";
      this.onfinish?.();
    },
  };
  return anim;
}

describe("MotionRegistry", () => {
  it("drops callbacks before cancel and ignores a late finish", () => {
    const el = document.createElement("div");
    const registry = new MotionRegistry();
    let settled = 0;
    const anim = fakeAnim();
    const token = registry.token(el);
    registry.track(el, token, anim, "clip", () => {
      settled += 1;
    });
    const late = anim.onfinish;
    registry.stop(el);
    expect(anim.onfinish).toBeNull();
    expect(anim.oncancel).toBeNull();
    expect(anim.cancelCalls).toBe(1);
    late?.();
    expect(settled).toBe(0);

    const next = fakeAnim();
    registry.track(el, registry.token(el), next, "fade", () => {
      settled += 1;
    });
    next.finish();
    expect(settled).toBe(1);
  });

  it("rejects a track call that lost the token race", () => {
    const el = document.createElement("div");
    const registry = new MotionRegistry();
    const token = registry.token(el);
    registry.stop(el);
    const anim = fakeAnim();
    registry.track(el, token, anim, "move");
    expect(anim.cancelCalls).toBe(1);
    anim.finish();
    expect(anim.playState).toBe("finished");
  });

  it("lets a stale finish clear the next animation when the token guard is off", () => {
    const el = document.createElement("div");
    const registry = new MotionRegistry();
    registry.guardToken = false;
    let settled = 0;
    const anim = fakeAnim();
    registry.track(el, registry.token(el), anim, "clip", () => {
      settled += 1;
    });
    const late = anim.onfinish;
    registry.stop(el);
    late?.();
    expect(settled).toBe(1);
  });
});

describe("readMotionRows", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("uses a cached clip instead of the collapsed border height", () => {
    const root = document.createElement("div");
    const row = document.createElement("div");
    row.className = "result-virtual-row";
    row.dataset.rowKey = "hit:0";
    row.style.transform = "translateY(0px)";
    const motion = document.createElement("div");
    motion.className = "result-row-motion";
    const button = document.createElement("button");
    button.className = "result-log";
    button.dataset.hitIndex = "0";
    button.getBoundingClientRect = () => new DOMRect(0, 10, 100, 76);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { clipPath: "inset(0px 0px -418.047px)" } as CSSStyleDeclaration;
    });
    motion.append(button);
    row.append(motion);
    root.append(row);
    document.body.append(root);
    rememberClip(
      button,
      {
        cancel() {},
        onfinish: null,
        oncancel: null,
        playState: "running",
        effect: { getComputedTiming: () => ({ progress: 0.1 }) },
      },
      535,
      76,
      COLLAPSE_MS,
      COLLAPSE_EASE,
    );
    const rows = readMotionRows(root);
    expect(rows[0]?.borderHeight).toBe(76);
    expect(rows[0]?.visualHeight).toBeCloseTo(535 + (76 - 535) * 0.1, 4);
    expect(spy).not.toHaveBeenCalled();
  });

  it("parses a three-value computed inset when nothing is cached", () => {
    const root = document.createElement("div");
    const row = document.createElement("div");
    row.className = "result-virtual-row";
    row.dataset.rowKey = "hit:1";
    row.style.transform = "translateY(0px)";
    const motion = document.createElement("div");
    motion.className = "result-row-motion";
    const button = document.createElement("button");
    button.className = "result-log";
    button.dataset.hitIndex = "1";
    button.getBoundingClientRect = () => new DOMRect(0, 10, 100, 76);
    button.getAnimations = () => [{ playState: "running" } as Animation];
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { clipPath: "inset(0px 0px -418.047px)" } as CSSStyleDeclaration;
    });
    motion.append(button);
    row.append(motion);
    root.append(row);
    document.body.append(root);
    const rows = readMotionRows(root);
    expect(rows[0]?.visualHeight).toBeCloseTo(494.047, 3);
  });
});

describe("snapshotForSwitch", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("reads visual position before cancelling", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation((node) => {
      const el = node as HTMLElement;
      return { clipPath: el.style.clipPath || "none" } as CSSStyleDeclaration;
    });
    const root = document.createElement("div");
    const row = document.createElement("div");
    row.className = "result-virtual-row";
    row.dataset.rowKey = "hit:0";
    row.style.transform = "translateY(10px)";
    const motion = document.createElement("div");
    motion.className = "result-row-motion";
    const button = document.createElement("button");
    button.className = "result-log";
    button.dataset.hitIndex = "0";
    button.style.clipPath = "inset(0px 0px 80px 0px)";
    button.getBoundingClientRect = () => new DOMRect(0, 40, 100, 200);
    motion.append(button);
    row.append(motion);
    root.append(row);
    document.body.append(root);

    const registry = new MotionRegistry();
    const stop = registry.stop.bind(registry);
    registry.stop = (el) => {
      button.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50);
      button.style.clipPath = "";
      return stop(el);
    };
    const rows = snapshotForSwitch(root, registry, () => new Set(["hit:0"]));
    expect(rows[0]?.top).toBe(40);
    expect(rows[0]?.visualHeight).toBe(120);
    expect(button.getBoundingClientRect().top).toBe(0);
  });
});

describe("startSwitchMotion", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("clips the changing rows and does not translate a row above them", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      return { clipPath: "none", backgroundColor: "" } as CSSStyleDeclaration;
    });
    const root = document.createElement("div");
    const built: HTMLElement[] = [];
    for (const spec of [
      { key: "hit:0", hit: 0, doc: 0, top: 0, height: 50 },
      { key: "hit:1", hit: 1, doc: 50, top: 50, height: 240 },
      { key: "hit:2", hit: 2, doc: 290, top: 290, height: 50 },
    ]) {
      const row = document.createElement("div");
      row.className = "result-virtual-row";
      row.dataset.rowKey = spec.key;
      row.dataset.index = String(spec.hit);
      row.style.transform = `translateY(${spec.doc}px)`;
      const motion = document.createElement("div");
      motion.className = "result-row-motion";
      const button = document.createElement("button");
      button.className = "result-log is-open";
      button.dataset.hitIndex = String(spec.hit);
      const text = document.createElement("span");
      text.className = "result-text";
      button.append(text);
      button.getBoundingClientRect = () =>
        new DOMRect(0, spec.top, 100, spec.height);
      motion.append(button);
      row.append(motion);
      root.append(row);
      built.push(row);
    }
    document.body.append(root);
    const capture = snapshotForSwitch(
      root,
      new MotionRegistry(),
      () => new Set(),
    );
    const opening = built[1]?.querySelector("button");
    if (opening instanceof HTMLElement) {
      opening.getBoundingClientRect = () => new DOMRect(0, 50, 100, 50);
    }
    const below = built[2]?.querySelector("button");
    if (below instanceof HTMLElement) {
      below.getBoundingClientRect = () => new DOMRect(0, 100, 100, 50);
    }
    const targets: HTMLElement[] = [];
    const registry = new MotionRegistry();
    startSwitchMotion({
      root,
      registry,
      capture,
      opening: null,
      closing: [1],
      anchorStart: 290,
      scrollDelta: 0,
      pendingStart: () => undefined,
      onCollapseSettled: () => undefined,
      animate: (el, frames, options) => {
        targets.push(el);
        return {
          cancel() {},
          onfinish: null,
          oncancel: null,
          playState: "running",
          frames,
          options,
        };
      },
    });
    expect(targets.includes(built[0] as HTMLElement)).toBe(false);
    const motionAbove = built[0]?.querySelector(".result-row-motion");
    expect(targets.includes(motionAbove as HTMLElement)).toBe(false);
    expect(targets.some((el) => el.classList.contains("result-log"))).toBe(
      true,
    );
  });

  it("clips from the new target border while the element still wears the old one", () => {
    // Review case: animate runs before layout paints the new border.
    // Expand side is still 76px (visible 90). Collapse side is still 555.4
    // (visible 543.7). The inset has to use the border the row is going to,
    // which may be negative when the visible tail overflows that border.
    const root = document.createElement("div");
    const specs = [
      {
        key: "hit:0",
        hit: 0,
        doc: 0,
        top: 0,
        height: 555.4,
        clip: "inset(0px 0px 11.7px 0px)",
      },
      {
        key: "hit:1",
        hit: 1,
        doc: 555.4,
        top: 200,
        height: 76,
        clip: "inset(0px 0px -14px 0px)",
      },
    ];
    for (const spec of specs) {
      const row = document.createElement("div");
      row.className = "result-virtual-row";
      row.dataset.rowKey = spec.key;
      row.dataset.index = String(spec.hit);
      row.style.transform = `translateY(${spec.doc}px)`;
      const motion = document.createElement("div");
      motion.className = "result-row-motion";
      const button = document.createElement("button");
      button.className = "result-log";
      button.dataset.hitIndex = String(spec.hit);
      button.style.clipPath = spec.clip;
      button.getBoundingClientRect = () =>
        new DOMRect(0, spec.top, 100, spec.height);
      motion.append(button);
      row.append(motion);
      root.append(row);
    }
    document.body.append(root);
    const capture = readMotionRows(root);
    const closing = capture.find((row) => row.hitIndex === 0);
    const opening = capture.find((row) => row.hitIndex === 1);
    expect(closing?.borderHeight).toBeCloseTo(555.4, 2);
    expect(closing?.visualHeight).toBeCloseTo(543.7, 2);
    expect(opening?.borderHeight).toBeCloseTo(76, 2);
    expect(opening?.visualHeight).toBeCloseTo(90, 2);

    const atAnimate = new Map<number, number>();
    const insets = new Map<number, number | null>();
    startSwitchMotion({
      root,
      registry: new MotionRegistry(),
      capture,
      opening: 1,
      closing: [0],
      anchorStart: null,
      scrollDelta: 0,
      liveRows: capture,
      pendingStart: () => undefined,
      onCollapseSettled: () => undefined,
      targetBorder: (hitIndex, openingRow) =>
        openingRow ? 555.4 : hitIndex === 0 ? 76 : undefined,
      animate: (el, frames) => {
        const list = Array.isArray(frames) ? frames : [];
        const clip = list[0]?.clipPath;
        if (typeof clip === "string" && el instanceof HTMLElement) {
          const hit = Number(el.dataset.hitIndex);
          atAnimate.set(hit, el.getBoundingClientRect().height);
          insets.set(hit, parseClipBottom(clip));
        }
        return {
          cancel() {},
          onfinish: null,
          oncancel: null,
          playState: "running",
        };
      },
    });

    expect(atAnimate.get(0)).toBeCloseTo(555.4, 2);
    expect(atAnimate.get(1)).toBeCloseTo(76, 2);
    expect(insets.get(1)).toBeCloseTo(555.4 - 90, 2);
    expect(insets.get(0)).toBeCloseTo(76 - 543.7, 2);
    expect(Math.abs((insets.get(1) ?? 0) - (76 - 90))).toBeGreaterThan(100);
    expect(Math.abs((insets.get(0) ?? 0) - (555.4 - 543.7))).toBeGreaterThan(
      100,
    );
  });
});
