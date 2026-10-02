/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import type { SseHit } from "@web-grep/shared";
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultList } from "../components/ResultList.tsx";
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
  const listNavRef = useRef<(index: number) => void>(() => {});
  const [selected, setSelected] = useState(initial);
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const onListNav = useCallback((index: number) => {
    listNavRef.current(index);
  }, []);
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
    selectedIndexRef: selectedRef,
    onListNav,
  });
  return (
    <LocaleProvider>
      <ResultList
        hits={hits}
        selectedIndex={selected}
        onSelect={(index) => {
          selectedSpy(index);
          setSelected(index);
        }}
        listRef={listRef}
        listNavRef={listNavRef}
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
    fireEvent.pointerLeave(scrollEl());
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

    fireEvent.pointerLeave(scrollEl());
    expect(openIndex()).toBe(1);

    moveTo(0);
    settle(150);
    expect(openIndex()).toBe(0);
    fireEvent.pointerLeave(scrollEl());
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
});

describe("j/k list movement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function bind(opts: {
    hitCount: number;
    setSelectedIndex: (value: number | ((index: number) => number)) => void;
    selectedIndexRef?: RefObject<number>;
    onListNav?: (index: number) => void;
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

  it("keeps the functional j/k updater when list nav is not wired", () => {
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

  it("reports the landed index for j/k and arrows without changing the step", () => {
    const setSelectedIndex = vi.fn();
    const onListNav = vi.fn();
    const selectedIndexRef = { current: 2 };
    bind({ hitCount: 5, setSelectedIndex, selectedIndexRef, onListNav });
    press("j");
    expect(setSelectedIndex).toHaveBeenCalledWith(3);
    expect(onListNav).toHaveBeenCalledWith(3);
    selectedIndexRef.current = 2;
    press("ArrowUp");
    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(onListNav).toHaveBeenCalledWith(1);
    selectedIndexRef.current = 0;
    press("k");
    expect(setSelectedIndex).toHaveBeenLastCalledWith(0);
    expect(onListNav).toHaveBeenLastCalledWith(0);
  });
});
