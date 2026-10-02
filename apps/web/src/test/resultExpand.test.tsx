/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import type { SseHit } from "@web-grep/shared";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultList } from "../components/ResultList.tsx";
import { HOVER_REST_MS } from "../hooks/useResultExpand.ts";
import { useHotkeys } from "../hooks/useHotkeys.ts";
import { LocaleProvider } from "../hooks/useLocale.ts";

const NEEDLE = "NEEDLE";

function hit(line: number, text: string): SseHit {
  const at = text.indexOf(NEEDLE);
  return {
    path: "logs/app.log",
    line,
    text,
    matches: at < 0 ? [] : [{ start: at, end: at + NEEDLE.length }],
  };
}

function longLine(line: number): SseHit {
  return hit(line, `${NEEDLE} ${"x".repeat(220)}`);
}

const patchedProps = [
  "clientHeight",
  "scrollHeight",
  "offsetHeight",
  "offsetWidth",
] as const;
const savedProps = new Map<string, PropertyDescriptor | undefined>();

function installLayoutStubs(): void {
  for (const prop of patchedProps) {
    savedProps.set(
      prop,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
    );
  }
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("result-text")) {
        return 40;
      }
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("result-text")) {
        return (this.textContent ?? "").length > 80 ? 120 : 20;
      }
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
}

function restoreLayoutStubs(): void {
  for (const prop of patchedProps) {
    const saved = savedProps.get(prop);
    if (saved !== undefined) {
      Object.defineProperty(HTMLElement.prototype, prop, saved);
    }
  }
}

function scrollEl(): HTMLElement {
  const el = document.querySelector(".result-list-scroll");
  if (!(el instanceof HTMLElement)) {
    throw new Error("missing result list");
  }
  return el;
}

function hitButton(index: number): HTMLButtonElement {
  const el = document.querySelector(`[data-hit-index="${index}"]`);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`missing hit ${index}`);
  }
  return el;
}

function openIndex(): number | null {
  const el = document.querySelector(".result-log.is-open");
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  return Number(el.getAttribute("data-hit-index"));
}

function openIndexes(): number[] {
  return [...document.querySelectorAll(".result-log.is-open")].map((el) =>
    Number(el.getAttribute("data-hit-index")),
  );
}

function listShell(): HTMLElement {
  const el = scrollEl().parentElement;
  if (!(el instanceof HTMLElement)) {
    throw new Error("missing result list shell");
  }
  return el;
}

function rowStart(index: number): number {
  const row = hitButton(index).closest(".result-virtual-row");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`missing virtual row ${index}`);
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(row.style.transform);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function moveTo(index: number): void {
  fireEvent.pointerMove(hitButton(index), {
    clientX: 40,
    clientY: 48 + index * 4,
  });
}

function settle(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const selectedSpy = vi.fn();

function Harness({ hits, initial = 0 }: { hits: SseHit[]; initial?: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(initial);
  useHotkeys({
    onSearch: vi.fn(),
    onCancel: vi.fn(),
    onCopyPath: vi.fn(),
    running: false,
    modalOpen: false,
    queryRef: { current: null },
    listRef,
    previewRef: { current: null },
    hitCount: hits.length,
    setSelectedIndex: setSelected,
  });
  return (
    <LocaleProvider>
      <span data-testid="selected-index">{selected}</span>
      <ResultList
        hits={hits}
        selectedIndex={selected}
        onSelect={(index) => {
          selectedSpy(index);
          setSelected(index);
        }}
        listRef={listRef}
        terms={[NEEDLE]}
      />
    </LocaleProvider>
  );
}

describe("result row expand", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installLayoutStubs();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    document.elementFromPoint = () => null;
    selectedSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    restoreLayoutStubs();
  });

  it("opens a truncated row only after the pointer rests 150ms", () => {
    const text = `${NEEDLE} ${"x".repeat(220)}`;
    render(<Harness hits={[hit(1, text), longLine(2)]} />);
    const count = text.length.toLocaleString("zh-CN");
    expect(hitButton(0).querySelector(".result-lenchip")?.textContent).toBe(
      `长行 ${count} 字符`,
    );
    expect(hitButton(0).getAttribute("aria-expanded")).toBe("false");
    expect(hitButton(0).classList.contains("is-open")).toBe(false);

    moveTo(0);
    settle(149);
    expect(openIndex()).toBeNull();

    settle(1);
    const open = hitButton(0);
    expect(open.classList.contains("is-open")).toBe(true);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.querySelector(".result-lenchip")).toBeNull();
    expect(open.querySelector(".result-xnote b")?.textContent).toBe(
      `整行 ${count} 字符`,
    );
    expect(open.textContent).toContain("点击在右侧渲染");
    expect(open.textContent).toContain(text);
    expect(open.querySelector(".result-snip-skip")).toBeNull();
    expect(open.querySelector(".result-xnote-cut")).toBeNull();
    expect(open.querySelector("mark")?.textContent).toBe(NEEDLE);
  });

  it("does not open while the pointer is only passing over rows", () => {
    const hits = Array.from({ length: 10 }, (_, index) => longLine(index + 1));
    render(<Harness hits={hits} />);
    let classChanges = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.attributeName === "class" &&
          record.target instanceof Element &&
          record.target.classList.contains("result-log")
        ) {
          classChanges += 1;
        }
      }
    });
    observer.observe(scrollEl(), {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    for (let index = 0; index < hits.length; index += 1) {
      moveTo(index);
      settle(40);
    }

    expect(openIndex()).toBeNull();
    expect(classChanges).toBe(0);
    observer.disconnect();
  });

  it("does not expand a row that is not truncated", () => {
    render(<Harness hits={[longLine(1), hit(2, "short NEEDLE")]} />);
    const short = hitButton(1);
    expect(short.getAttribute("data-truncated")).toBe("0");
    expect(short.hasAttribute("aria-expanded")).toBe(false);
    expect(short.querySelector(".result-lenchip")).toBeNull();

    moveTo(1);
    settle(150);
    expect(openIndex()).toBeNull();
    expect(short.classList.contains("is-open")).toBe(false);
    expect(short.hasAttribute("aria-expanded")).toBe(false);
  });

  it("collapses the previous row when the pointer rests on another", () => {
    render(<Harness hits={[longLine(1), longLine(2), hit(3, "tiny")]} />);
    moveTo(0);
    settle(150);
    expect(openIndex()).toBe(0);

    moveTo(1);
    settle(149);
    expect(openIndex()).toBe(0);
    settle(1);
    expect(openIndex()).toBe(1);
    expect(hitButton(0).classList.contains("is-open")).toBe(false);
    expect(hitButton(0).getAttribute("aria-expanded")).toBe("false");

    moveTo(2);
    settle(150);
    expect(openIndex()).toBeNull();
    expect(hitButton(1).querySelector(".result-lenchip")).toBeTruthy();
  });

  it("collapses a pointer-opened row as soon as the pointer leaves the list", () => {
    render(<Harness hits={[longLine(1)]} />);
    moveTo(0);
    settle(150);
    expect(openIndex()).toBe(0);
    // The sticky file header sits outside the scroller. Leaving only the
    // scroller (onto that header) keeps the row; leaving the shell closes it.
    fireEvent.pointerLeave(scrollEl());
    expect(openIndex()).toBe(0);
    fireEvent.pointerMove(listShell().querySelector(".result-sticky-header") ?? listShell());
    settle(300);
    expect(openIndex()).toBe(0);
    fireEvent.pointerLeave(listShell());
    expect(openIndex()).toBeNull();
  });

  it("ignores hover changes while the list is scrolling", () => {
    render(<Harness hits={[longLine(1), longLine(2)]} />);
    fireEvent.scroll(scrollEl());
    moveTo(0);
    settle(150);
    expect(openIndex()).toBeNull();
    settle(149);
    expect(openIndex()).toBeNull();
    settle(1);
    expect(openIndex()).toBe(0);
  });

  it("expands the keyboard selection and lets the pointer take over", () => {
    render(
      <Harness
        hits={[longLine(1), longLine(2), hit(3, "short"), longLine(4)]}
      />,
    );
    expect(openIndex()).toBeNull();
    expect(hitButton(0).classList.contains("selected")).toBe(true);

    press("j");
    expect(hitButton(1).classList.contains("selected")).toBe(true);
    expect(openIndex()).toBe(1);
    expect(hitButton(1).getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerLeave(listShell());
    expect(openIndex()).toBe(1);

    moveTo(0);
    settle(150);
    expect(openIndex()).toBe(0);
    fireEvent.pointerLeave(listShell());
    expect(openIndex()).toBeNull();

    press("j");
    expect(hitButton(2).classList.contains("selected")).toBe(true);
    expect(openIndex()).toBeNull();
    expect(hitButton(2).hasAttribute("aria-expanded")).toBe(false);
  });

  it("does not keyboard-expand when the row is clicked", () => {
    render(<Harness hits={[longLine(1), longLine(2)]} />);
    fireEvent.click(hitButton(1));
    expect(selectedSpy).toHaveBeenCalledTimes(1);
    expect(selectedSpy).toHaveBeenCalledWith(1);
    expect(hitButton(1).classList.contains("selected")).toBe(true);
    expect(openIndex()).toBeNull();
    expect(hitButton(1).getAttribute("aria-expanded")).toBe("false");
  });

  it("marks a capped expand with the omitted-count chip and the cap note", () => {
    const text = `${"甲".repeat(4000)}NEEDLE${"乙".repeat(1200)}`;
    render(<Harness hits={[hit(8, text)]} />);
    moveTo(0);
    settle(150);
    const open = hitButton(0);
    expect(open.querySelector(".result-xnote-cut")?.textContent).toBe(
      "为了不占满列表，只展开行首和命中附近",
    );
    const skips = [...open.querySelectorAll(".result-snip-skip")].map(
      (node) => node.textContent ?? "",
    );
    expect(skips.length).toBeGreaterThan(0);
    for (const skip of skips) {
      expect(skip.startsWith("··· ")).toBe(true);
      expect(skip.endsWith(" ···")).toBe(true);
      expect(skip).toContain("省略");
      expect(skip).toContain("字符");
    }
    expect(open.querySelector("mark")?.textContent).toBe(NEEDLE);
    expect(open.querySelector(".result-xnote b")?.textContent).toBe(
      `整行 ${text.length.toLocaleString("zh-CN")} 字符`,
    );
  });

  it("does not open when a pointer-rest callback runs while the list is scrolling", () => {
    const hoverCallbacks: Array<() => void> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    const spy = vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (typeof fn === "function" && ms === HOVER_REST_MS) {
        hoverCallbacks.push(() => {
          fn(...args);
        });
      }
      return realSetTimeout(fn as () => void, ms, ...(args as []));
    }) as typeof window.setTimeout);

    render(<Harness hits={[longLine(1), longLine(2)]} />);
    fireEvent.scroll(scrollEl());
    hoverCallbacks.length = 0;
    moveTo(0);
    act(() => {
      for (const callback of hoverCallbacks) {
        callback();
      }
    });
    expect(openIndex()).toBeNull();
    spy.mockRestore();
  });
});

const savedRect = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "getBoundingClientRect",
);

function installMeasuredBoxes(): void {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("result-text")) {
        return (this.textContent ?? "").length > 80 ? 120 : 20;
      }
      if (this.classList.contains("result-list-scroll")) {
        return 8000;
      }
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const scroller = this.closest(".result-list-scroll");
      const scrollTop = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
      if (this.classList.contains("result-list-inner")) {
        return new DOMRect(0, -scrollTop, 400, 5000);
      }
      if (this.classList.contains("result-list-scroll")) {
        return new DOMRect(0, 0, 400, 600);
      }
      const virtual = this.closest(".result-virtual-row");
      const match =
        virtual instanceof HTMLElement
          ? /translateY\(([-\d.]+)px\)/.exec(virtual.style.transform)
          : null;
      const start = match?.[1] === undefined ? 0 : Number(match[1]);
      const top = start - scrollTop;
      if (this.classList.contains("result-log")) {
        const height = this.classList.contains("is-open") ? 240 : 50;
        return new DOMRect(0, top, 400, height);
      }
      if (
        this.classList.contains("result-virtual-row") ||
        this.classList.contains("result-group-header")
      ) {
        const open = this.querySelector(".result-log.is-open") !== null;
        const header =
          this.classList.contains("is-header") ||
          this.classList.contains("result-group-header");
        return new DOMRect(0, top, 400, header ? 36 : open ? 240 : 50);
      }
      return new DOMRect(0, 0, 0, 0);
    },
  });
}

function restoreMeasuredBoxes(): void {
  if (savedRect !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", savedRect);
  }
}

describe("scroll compensation and retained rows", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installLayoutStubs();
    installMeasuredBoxes();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    document.elementFromPoint = () => null;
    selectedSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    restoreMeasuredBoxes();
    restoreLayoutStubs();
  });

  function openPair(): void {
    moveTo(0);
    settle(150);
    expect(openIndexes()).toEqual([0]);
  }

  it("keeps the row above when scrollTop cannot absorb the collapse", () => {
    render(<Harness hits={[longLine(1), longLine(2), longLine(3)]} />);
    openPair();
    const before = rowStart(1);
    moveTo(1);
    settle(150);
    expect(openIndexes()).toEqual([0, 1]);
    expect(Math.abs(rowStart(1) - before)).toBeLessThanOrEqual(1);
    expect(scrollEl().scrollTop).toBe(0);
  });

  it("keeps the row above when scrollTop is smaller than the shrink", () => {
    render(<Harness hits={[longLine(1), longLine(2)]} />);
    openPair();
    scrollEl().scrollTop = 10;
    fireEvent.scroll(scrollEl());
    settle(150);
    const before = rowStart(1);
    moveTo(1);
    settle(150);
    expect(openIndexes()).toEqual([0, 1]);
    expect(Math.abs(rowStart(1) - before)).toBeLessThanOrEqual(1);
  });

  it("collapses the row above and compensates scrollTop when the room is enough", () => {
    render(<Harness hits={[longLine(1), longLine(2), longLine(3)]} />);
    openPair();
    const end = rowStart(0) + hitButton(0).getBoundingClientRect().height;
    const shrink = hitButton(0).getBoundingClientRect().height - 50;
    expect(shrink).toBeGreaterThan(1);
    expect(end - 10).toBeGreaterThanOrEqual(shrink);
    scrollEl().scrollTop = end - 10;
    fireEvent.scroll(scrollEl());
    settle(150);
    const before = scrollEl().scrollTop;
    const startBefore = rowStart(1);
    moveTo(1);
    settle(200);
    expect(openIndexes()).toEqual([1]);
    expect(before - scrollEl().scrollTop).toBeGreaterThan(shrink - 2);
    expect(Math.abs(rowStart(1) - scrollEl().scrollTop - (startBefore - before))).toBeLessThanOrEqual(
      1,
    );
  });

  it("collapses a retained row once scrolling leaves enough room", () => {
    render(<Harness hits={[longLine(1), longLine(2)]} />);
    openPair();
    moveTo(1);
    settle(150);
    expect(openIndexes()).toEqual([0, 1]);
    scrollEl().scrollTop = 800;
    fireEvent.scroll(scrollEl());
    settle(150);
    expect(openIndexes()).toEqual([1]);
  });

  it("drops retained rows when the group is folded or sorted", () => {
    render(<Harness hits={[longLine(1), longLine(2)]} />);
    openPair();
    moveTo(1);
    settle(150);
    expect(openIndexes()).toEqual([0, 1]);
    const sort = document.querySelector(".result-sort");
    if (!(sort instanceof HTMLElement)) {
      throw new Error("missing sort button");
    }
    fireEvent.click(sort);
    expect(openIndexes()).toEqual([1]);

    const fold = document.querySelector(".result-fold-all");
    if (!(fold instanceof HTMLElement)) {
      throw new Error("missing fold button");
    }
    fireEvent.click(fold);
    fireEvent.click(fold);
    expect(openIndexes()).toEqual([1]);
  });
});

function selectedIndex(): number {
  const el = document.querySelector("[data-testid='selected-index']");
  return Number(el?.textContent ?? "NaN");
}

describe("j/k list movement", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installLayoutStubs();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    document.elementFromPoint = () => null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    restoreLayoutStubs();
  });

  function bind(opts: {
    hitCount: number;
    setSelectedIndex: (value: number | ((index: number) => number)) => void;
  }): void {
    renderHook(() =>
      useHotkeys({
        onSearch: vi.fn(),
        onCancel: vi.fn(),
        onCopyPath: vi.fn(),
        running: false,
        modalOpen: false,
        queryRef: { current: null },
        listRef: { current: null },
        previewRef: { current: null },
        ...opts,
      }),
    );
  }

  it("keeps the functional j/k updater", () => {
    const setSelectedIndex = vi.fn();
    bind({ hitCount: 5, setSelectedIndex });
    press("j");
    const down = setSelectedIndex.mock.calls[0]?.[0] as (
      index: number,
    ) => number;
    expect(down(2)).toBe(3);
    expect(down(4)).toBe(4);
    setSelectedIndex.mockClear();
    press("k");
    const up = setSelectedIndex.mock.calls[0]?.[0] as (index: number) => number;
    expect(up(2)).toBe(1);
    expect(up(0)).toBe(0);
  });

  it("applies synchronous j/k repeats with the functional updater", () => {
    const hits = Array.from({ length: 40 }, (_, index) => longLine(index + 1));
    render(<Harness hits={hits} />);
    act(() => {
      for (let i = 0; i < 2; i += 1) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
        );
      }
    });
    expect(selectedIndex()).toBe(2);

    act(() => {
      for (let i = 0; i < 30; i += 1) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "j",
            bubbles: true,
            cancelable: true,
            repeat: i > 0,
          }),
        );
      }
    });
    expect(selectedIndex()).toBe(32);

    cleanup();
    render(<Harness hits={hits} />);
    act(() => {
      for (let i = 0; i < 10; i += 1) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
        );
      }
    });
    expect(selectedIndex()).toBe(10);
    act(() => {
      for (let i = 0; i < 6; i += 1) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
        );
      }
    });
    expect(selectedIndex()).toBe(4);

    cleanup();
    render(<Harness hits={hits} />);
    press("k");
    expect(selectedIndex()).toBe(0);
    act(() => {
      for (let i = 0; i < 80; i += 1) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
        );
      }
    });
    expect(selectedIndex()).toBe(39);
    press("j");
    expect(selectedIndex()).toBe(39);
  });

  it("ignores j/k while an input is the event target", () => {
    render(<Harness hits={[longLine(1), longLine(2), longLine(3)]} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
    );
    expect(selectedIndex()).toBe(0);
    input.remove();
  });
});
