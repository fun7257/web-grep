/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnimLike,
  affectedKeys,
  translatePlan,
  COLLAPSE_EASE,
  COLLAPSE_MS,
  clipRange,
  collapseHeadDiffers,
  EXPAND_EASE,
  EXPAND_MS,
  type HeightCause,
  MotionRegistry,
  parseClipBottom,
  planTranslatePieces,
  predictScrollDelta,
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
    expect(parseClipBottom("none")).toBeNull();
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

  it("locks a closing row and the rows above it to the collapse clock", () => {
    const causes = [collapse(0, -479), expand(500, 479)];
    expect(translatePlan(-479, true, 0, 500, causes, -479)).toEqual([
      { fromY: -479, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
    expect(translatePlan(-479, true, 36, 500, causes, -479)).toEqual([
      { fromY: -479, duration: COLLAPSE_MS, easing: COLLAPSE_EASE },
    ]);
    expect(translatePlan(0.2, true, 0, 500, causes, 0)).toEqual([]);
  });

  it("still splits a row below an expand onto the expand clock", () => {
    const causes = [collapse(0, -150), expand(200, 150)];
    expect(translatePlan(-150, false, 500, 200, causes, -150)).toEqual([
      { fromY: -150, duration: EXPAND_MS, easing: EXPAND_EASE },
    ]);
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
});
