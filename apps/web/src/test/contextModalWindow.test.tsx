/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { FileWindowResponse } from "@web-grep/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFileWindow } from "../api/fileClient.ts";
import { ContextModal } from "../components/ContextModal.tsx";
import { rangeForLine, upwardRange } from "../fileWindow.ts";
import { LocaleProvider } from "../hooks/useLocale.ts";
import { livePreviewChunkMax, setLivePreviewLimits } from "../previewChunk.ts";

vi.mock("../api/fileClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/fileClient.ts")>();
  return {
    ...actual,
    fetchFileWindow: vi.fn(),
  };
});

const fetchMock = vi.mocked(fetchFileWindow);
const CHUNK = 160;

type Query = { path: string; from?: number; count?: number; tail?: boolean };

function pageFor(query: Query, eof = false): FileWindowResponse {
  const from = query.from ?? 1;
  const count = query.count ?? CHUNK;
  const lines = [];
  for (let n = from; n < from + count; n++) {
    lines.push({ n, text: `L${n}` });
  }
  return {
    path: query.path,
    startLine: from,
    lineCount: lines.length,
    truncated: false,
    binary: false,
    eof,
    lines,
  };
}

function fileCalls(): Query[] {
  return fetchMock.mock.calls.map((call) => call[0]);
}

function firstVisibleLine(scroller: HTMLElement): number | null {
  const top = scroller.scrollTop;
  let bestStart = Number.POSITIVE_INFINITY;
  let bestN: number | null = null;
  for (const row of scroller.querySelectorAll<HTMLElement>(
    ".context-virtual-row",
  )) {
    const match = /translateY\(([-\d.]+)px\)/.exec(row.style.transform);
    if (match === null) {
      continue;
    }
    const start = Number(match[1]);
    if (start + 20 <= top + 0.5) {
      continue;
    }
    if (start < bestStart) {
      bestStart = start;
      const n = Number(row.querySelector(".preview-n")?.textContent);
      bestN = Number.isInteger(n) ? n : null;
    }
  }
  return bestN;
}

type Restore = () => void;

function installLayout(): Restore {
  const restores: Restore[] = [];
  const patch = (
    proto: object,
    name: string,
    descriptor: PropertyDescriptor,
  ): void => {
    const prev = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, descriptor);
    restores.push(() => {
      if (prev !== undefined) {
        Object.defineProperty(proto, name, prev);
      } else {
        delete (proto as Record<string, unknown>)[name];
      }
    });
  };

  const heightOf = (el: HTMLElement): number => {
    if (el.classList.contains("context-lines")) {
      return 600;
    }
    if (
      el.classList.contains("context-virtual-row") ||
      el.classList.contains("preview-line")
    ) {
      return 20;
    }
    return 0;
  };

  patch(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return heightOf(this);
    },
  });
  patch(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("context-lines") ? 800 : 0;
    },
  });
  patch(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this instanceof HTMLElement ? heightOf(this) : 0;
    },
  });
  patch(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      if (
        !(this instanceof HTMLElement) ||
        !this.classList.contains("context-lines")
      ) {
        return 0;
      }
      const inner = this.querySelector<HTMLElement>(".context-lines-inner");
      const parsed = Number.parseFloat(inner?.style.height ?? "");
      return Number.isFinite(parsed) ? parsed : 0;
    },
  });

  const scrollTopDesc = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollTop",
  );
  if (scrollTopDesc?.get === undefined || scrollTopDesc.set === undefined) {
    throw new Error("jsdom scrollTop is not patchable");
  }
  const scrollTop = scrollTopDesc;
  const dispatching = new WeakSet<Element>();
  const readTop = (el: Element): number => {
    const getter = Reflect.get(scrollTop, "get") as (this: Element) => number;
    return Reflect.apply(getter, el, []) as number;
  };
  const writeTop = (el: Element, value: number): void => {
    const setter = Reflect.get(scrollTop, "set") as (
      this: Element,
      value: number,
    ) => void;
    Reflect.apply(setter, el, [value]);
  };
  patch(Element.prototype, "scrollTop", {
    configurable: true,
    enumerable: true,
    get(this: Element) {
      return readTop(this);
    },
    set(this: Element, value: number) {
      const prev = readTop(this);
      writeTop(this, value);
      const applied = readTop(this);
      if (applied === prev || dispatching.has(this)) {
        return;
      }
      dispatching.add(this);
      try {
        let seen = applied;
        for (let i = 0; i < 4; i++) {
          this.dispatchEvent(new Event("scroll"));
          const now = readTop(this);
          if (now === seen) {
            break;
          }
          seen = now;
        }
      } finally {
        dispatching.delete(this);
      }
    },
  });

  const rectDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  );
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("context-lines")) {
      return new DOMRect(0, 0, 800, 600);
    }
    const row = this.classList.contains("context-virtual-row")
      ? this
      : this.closest(".context-virtual-row");
    if (row instanceof HTMLElement) {
      const match = /translateY\(([-\d.]+)px\)/.exec(row.style.transform);
      const start = match === null ? 0 : Number(match[1]);
      const scroller = row.closest(".context-lines");
      const top =
        scroller instanceof HTMLElement ? start - scroller.scrollTop : start;
      return new DOMRect(0, top, 800, 20);
    }
    return new DOMRect(0, 0, 0, 0);
  };
  restores.push(() => {
    if (rectDesc !== undefined) {
      Object.defineProperty(
        HTMLElement.prototype,
        "getBoundingClientRect",
        rectDesc,
      );
    }
  });

  const scrollToDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollTo",
  );
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.scrollTop = top;
  };
  restores.push(() => {
    if (scrollToDesc !== undefined) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDesc);
      return;
    }
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      window.setTimeout(() => {
        cb(Date.now());
      }, 16) as unknown as number;
    window.cancelAnimationFrame = (id: number): void => {
      window.clearTimeout(id);
    };
    restores.push(() => {
      Reflect.deleteProperty(window, "requestAnimationFrame");
      Reflect.deleteProperty(window, "cancelAnimationFrame");
    });
  }

  return () => {
    for (const restore of restores.reverse()) {
      restore();
    }
  };
}

function renderModal(target: { path: string; highlightLine?: number }) {
  return render(
    <LocaleProvider>
      <ContextModal
        open
        target={target}
        previewChunk={CHUNK}
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("context modal window fill", () => {
  let restoreLayout: Restore;

  beforeEach(() => {
    restoreLayout = installLayout();
    setLivePreviewLimits(undefined);
  });

  afterEach(() => {
    cleanup();
    restoreLayout();
    setLivePreviewLimits(undefined);
    fetchMock.mockReset();
  });

  it("prepends one page at the top and keeps the anchor line", async () => {
    const initial = rangeForLine(30000, CHUNK, livePreviewChunkMax());
    const up = upwardRange(initial.from, CHUNK);
    if (up === null) {
      throw new Error("upward range missing");
    }
    let releaseUp: ((page: FileWindowResponse) => void) | null = null;
    let upwardCount = 0;
    fetchMock.mockImplementation((query) => {
      if (query.from !== undefined && query.from < initial.from) {
        upwardCount += 1;
        if (upwardCount === 1) {
          return new Promise<FileWindowResponse>((resolve) => {
            releaseUp = resolve;
          });
        }
        return Promise.resolve({
          ...pageFor({ path: query.path, from: 1, count: 1 }),
          eof: false,
        });
      }
      return Promise.resolve(pageFor(query));
    });

    renderModal({ path: "logs/big.log", highlightLine: 30000 });
    await waitFor(() => {
      expect(fileCalls().length).toBeGreaterThan(0);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    expect(fileCalls()).toEqual([
      expect.objectContaining({
        path: "logs/big.log",
        from: initial.from,
        count: initial.count,
      }),
    ]);

    const scroller = document.querySelector(".context-lines");
    expect(scroller).toBeInstanceOf(HTMLElement);
    const list = scroller as HTMLElement;
    expect(list.scrollTop).toBeGreaterThan(0);

    let anchor: number | null = null;
    act(() => {
      list.scrollTop = 40;
      anchor = firstVisibleLine(list);
    });
    expect(anchor).not.toBeNull();
    expect(fileCalls()).toHaveLength(2);
    expect(fileCalls()[1]).toEqual(
      expect.objectContaining({ from: up.from, count: up.count }),
    );

    act(() => {
      list.scrollTop = 0;
      list.scrollTop = 15;
    });
    expect(fileCalls()).toHaveLength(2);
    expect(releaseUp).not.toBeNull();

    await act(async () => {
      releaseUp?.(
        pageFor({ path: "logs/big.log", from: up.from, count: up.count }),
      );
    });
    await waitFor(() => {
      const visible = firstVisibleLine(list);
      expect(visible).not.toBeNull();
      expect(Math.abs((visible ?? 0) - (anchor ?? 0))).toBeLessThanOrEqual(1);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
    expect(fileCalls()).toHaveLength(2);
    const visible = firstVisibleLine(list);
    expect(Math.abs((visible ?? 0) - (anchor ?? 0))).toBeLessThanOrEqual(1);
  });

  it("appends one page at the bottom without moving the anchor line", async () => {
    let downCount = 0;
    let releaseDown: ((page: FileWindowResponse) => void) | null = null;
    fetchMock.mockImplementation((query) => {
      if (query.from === CHUNK + 1) {
        downCount += 1;
        if (downCount === 1) {
          return new Promise<FileWindowResponse>((resolve) => {
            releaseDown = resolve;
          });
        }
        return Promise.resolve({
          ...pageFor({ path: query.path, from: CHUNK + 1, count: 1 }),
          eof: true,
        });
      }
      return Promise.resolve(pageFor(query, false));
    });

    renderModal({ path: "logs/big.log" });
    const scroller = await waitFor(() => {
      const el = document.querySelector(".context-lines");
      expect(el).toBeInstanceOf(HTMLElement);
      return el as HTMLElement;
    });
    await waitFor(() => {
      expect(fileCalls()).toHaveLength(1);
    });
    expect(fileCalls()[0]).toEqual(
      expect.objectContaining({ from: 1, count: CHUNK }),
    );

    let anchor: number | null = null;
    act(() => {
      const total = Number.parseFloat(
        scroller.querySelector<HTMLElement>(".context-lines-inner")?.style
          .height ?? "0",
      );
      scroller.scrollTop = Math.max(0, total - 600);
      anchor = firstVisibleLine(scroller);
    });
    expect(anchor).not.toBeNull();
    expect(anchor).toBeGreaterThan(1);
    await waitFor(() => {
      expect(fileCalls().some((query) => query.from === CHUNK + 1)).toBe(true);
    });
    expect(
      fileCalls().filter((query) => query.from === CHUNK + 1),
    ).toHaveLength(1);

    await act(async () => {
      releaseDown?.(
        pageFor({ path: "logs/big.log", from: CHUNK + 1, count: CHUNK }, false),
      );
    });
    await waitFor(() => {
      const visible = firstVisibleLine(scroller);
      expect(Math.abs((visible ?? 0) - (anchor ?? 0))).toBeLessThanOrEqual(1);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(fileCalls().map((query) => query.from)).toEqual([1, CHUNK + 1]);
    const visible = firstVisibleLine(scroller);
    expect(visible).toBeGreaterThan(CHUNK / 2);
    expect(Math.abs((visible ?? 0) - (anchor ?? 0))).toBeLessThanOrEqual(1);
  });
});
