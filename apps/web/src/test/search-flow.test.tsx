/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.tsx";

const META = {
  engine: "rg",
  rgVersion: "14.1.0",
  rootLabel: "project",
  root: "/tmp/project",
  followSymlinks: false,
  limits: {
    maxResults: 10_000,
    maxResultsHard: 50_000,
    timeoutMs: 30_000,
    previewBytes: 1_048_576,
    previewLines: 201,
    queryMaxChars: 512,
  },
  defaultLocale: "zh-CN",
  authRequired: false,
} as const;

const HIT_A = {
  path: "src/a.ts",
  line: 1,
  text: "hello world",
  matches: [{ start: 0, end: 5 }],
};

const HIT_B = {
  path: "src/b.ts",
  line: 3,
  text: "hello there",
  matches: [{ start: 0, end: 5 }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function donePayload(
  overrides: {
    matchCount?: number;
    fileCount?: number;
    truncated?: boolean;
    timedOut?: boolean;
    cancelled?: boolean;
    elapsedMs?: number;
  } = {},
) {
  return {
    elapsedMs: 12,
    matchCount: 0,
    fileCount: 0,
    truncated: false,
    timedOut: false,
    cancelled: false,
    ...overrides,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function neverSettle(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal == null) {
      return;
    }
    const abort = (): void => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function fileWindowForUrl(url: string) {
  const parsed = new URL(url, "http://localhost");
  const path = parsed.searchParams.get("path") ?? "";
  const line = Number(parsed.searchParams.get("line") ?? "1");
  const from = Number(parsed.searchParams.get("from") ?? String(line));
  const count = Number(parsed.searchParams.get("count") ?? "160");
  const last = from + Math.min(count, 8) - 1;
  const lines = [];
  for (let n = from; n <= last; n++) {
    lines.push({ n, text: `${path} line ${n}` });
  }
  return {
    path,
    startLine: from,
    lineCount: lines.length,
    truncated: false,
    binary: false,
    eof: true,
    lines,
  };
}

function mockFetch(
  search: (init?: RequestInit) => Promise<Response> | Response,
  file?: (url: string, init?: RequestInit) => Promise<Response> | Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/api/meta")) {
      return Promise.resolve(jsonResponse(200, META));
    }
    if (url.includes("/api/tree")) {
      return Promise.resolve(
        jsonResponse(200, { path: "", entries: [], truncated: false }),
      );
    }
    if (url.includes("/api/search")) {
      return Promise.resolve(search(init));
    }
    if (url.includes("/api/file")) {
      if (file !== undefined) {
        return Promise.resolve(file(url, init));
      }
      return Promise.resolve(jsonResponse(200, fileWindowForUrl(url)));
    }
    return Promise.resolve(
      jsonResponse(404, { code: "INTERNAL", message: "not found" }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function typeQuery(value: string): void {
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value },
  });
}

function clickSearch(): void {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

function locMatcher(label: string) {
  return (_content: string, node: Element | null): boolean =>
    node instanceof HTMLElement &&
    node.classList.contains("result-loc") &&
    (node.textContent ?? "") === label;
}

function getLoc(label: string): HTMLElement {
  return screen.getByText(locMatcher(label));
}

function queryLoc(label: string): HTMLElement | null {
  return screen.queryByText(locMatcher(label));
}

describe("search flow", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("web-grep.locale", "en-US");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    for (const prop of ["offsetHeight", "clientHeight"] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: () => 600,
      });
    }
    for (const prop of ["offsetWidth", "clientWidth"] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: () => 800,
      });
    }
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a loading status on submit", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    typeQuery("needle");
    clickSearch();
    expect(screen.getByRole("status").textContent).toMatch(/Searching/);
  });

  it("renders two hit rows with path, line, and mark from a split SSE frame", async () => {
    const first = sseEvent("hit", HIT_A);
    const splitAt = Math.ceil(first.length / 2);
    mockFetch(() =>
      sseResponse([
        `: ping\n\n${first.slice(0, splitAt)}`,
        `${first.slice(splitAt)}${sseEvent("hit", HIT_B)}${sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 }))}`,
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    expect(getLoc("src/a.ts:1")).toBeTruthy();
    expect(getLoc("src/b.ts:3")).toBeTruthy();
    const marks = document.querySelectorAll('[role="listitem"] mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe("hello");
    expect(marks[1]?.textContent).toBe("hello");
  });

  it("shows No matches when done.matchCount is 0", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("meta", {
          searchId: "550e8400-e29b-41d4-a716-446655440000",
          engine: "rg",
        }),
        sseEvent("done", donePayload({ matchCount: 0 })),
      ]),
    );
    render(<App />);
    typeQuery("zzz");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByText("No matches")).toBeTruthy();
    });
  });

  it("shows cancelled after abort", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    clickSearch();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Cancelled/);
    });
  });

  it("keeps the hit row when an error event follows", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("error", { code: "ENGINE", message: "ripgrep failed" }),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/ripgrep failed/);
  });

  it("submits search on ⌘Enter", async () => {
    const fetchMock = mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            typeof call[0] === "string" && call[0].includes("/api/search"),
        ),
      ).toBe(true);
    });
  });

  it("opens the token prompt on 401", async () => {
    mockFetch(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getByRole("dialog").textContent).toMatch(
      /Enter access token/,
    );
  });

  it("keeps previous hits when a later submit returns 401", async () => {
    let searches = 0;
    mockFetch(() => {
      searches += 1;
      if (searches === 1) {
        return sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]);
      }
      return jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      });
    });
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(getLoc("src/a.ts:1")).toBeTruthy();
  });

  it("blurs the query on Escape when not running", () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    const input = screen.getByRole("searchbox");
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement === input).toBe(false);
  });

  it("does not search on ⌘Enter while the token prompt is open", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    const searchCalls = (): number =>
      fetchMock.mock.calls.filter(
        (entry) =>
          typeof entry[0] === "string" && entry[0].includes("/api/search"),
      ).length;
    const before = searchCalls();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(searchCalls()).toBe(before);
  });

  it("preview shows only the selected hit line", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("hit", HIT_B),
        sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current")?.textContent,
      ).toMatch(/hello world/);
    });
    expect(document.querySelector(".preview-text mark")?.textContent).toBe(
      "hello",
    );
    expect(document.querySelector(".preview-text mark")?.className).toContain(
      "hl-0",
    );
    expect(document.querySelectorAll(".preview-line")).toHaveLength(1);
    fireEvent.click(getLoc("src/b.ts:3"));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current")?.textContent,
      ).toMatch(/hello there/);
    });
    expect(document.querySelectorAll(".preview-line")).toHaveLength(1);
  });

  it("copy icon copies the full preview line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current")?.textContent,
      ).toMatch(/hello world/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy preview" }));
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("share icon offers an rg command and a webgrep link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share" });
    expect(dialog).toBeTruthy();
    const rgInput = dialog.querySelectorAll(
      "input",
    )[0] as HTMLInputElement | null;
    const linkInput = dialog.querySelectorAll(
      "input",
    )[1] as HTMLInputElement | null;
    expect(rgInput?.value).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:'",
    );
    expect(linkInput?.value).toContain("q=hello");
    expect(linkInput?.value).toContain("p=src");
    expect(linkInput?.value).toContain("n=1");
    fireEvent.click(screen.getByRole("button", { name: "Copy rg command" }));
    expect(writeText).toHaveBeenCalledWith(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:'",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(linkInput?.value);
  });

  it("opens a shared link and selects the named hit", async () => {
    window.history.replaceState({}, "", "/?q=hello&p=src%2Fb.ts&n=3");
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("hit", HIT_B),
        sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
      ]),
    );
    render(<App />);
    await waitFor(() => {
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current")?.textContent,
      ).toMatch(/hello there/);
    });
  });

  it("search selection starts a new query", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Search selection" }),
      ).toBeTruthy();
    });
    const previewText =
      document.querySelector(".preview-line.current .preview-text") ??
      document.querySelector(".preview-text");
    expect(previewText).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(previewText as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.click(screen.getByRole("button", { name: "Search selection" }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (entry) =>
          typeof entry[0] === "string" && entry[0].includes("/api/search"),
      );
      const raw = calls[calls.length - 1]?.[1]?.body;
      expect(typeof raw).toBe("string");
      if (typeof raw !== "string") {
        return;
      }
      const body = JSON.parse(raw) as { query: string; regex: boolean };
      expect(body.regex).toBe(false);
      expect(body.query).toBe("hello world");
    });
  });

  it("Shift+Enter adds AND without searching; Enter sends the stacked query", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
    });
    const searchesAfterFirst = searchCallCount(fetchMock);
    const box = screen.getByRole("searchbox");
    typeQuery("wor");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(
      [...document.querySelectorAll(".search-chip-row .q-chip-text")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["hello"]);
    expect(screen.getByRole("button", { name: "+1" })).toBeTruthy();
    expect(searchCallCount(fetchMock)).toBe(searchesAfterFirst);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => {
      const body = lastSearchBody(fetchMock);
      expect(body.regex).toBe(true);
      expect(body.query).toBe("hello.*wor|wor.*hello");
    });
    await waitFor(() => {
      expect(document.querySelector(".preview-text mark.hl-0")?.textContent).toBe(
        "hello",
      );
      expect(document.querySelector(".preview-text mark.hl-1")?.textContent).toBe(
        "wor",
      );
    });
  });

  it("Clear empties the query, results, and preview", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.querySelector(".preview-line.current")).toBeTruthy();
    });
    fireEvent.click(
      document.querySelector(".search-clear") as HTMLButtonElement,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(document.querySelectorAll(".q-chip")).toHaveLength(0);
    expect(queryLoc("src/a.ts:1")).toBeNull();
    expect(document.querySelector(".preview-line.current")).toBeNull();
    expect(document.querySelector(".empty-idle")).toBeTruthy();
    expect(document.querySelector(".preview-idle")).toBeTruthy();
  });

  it("expands a query overlay from the caret button", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    expect(document.querySelector(".search-dropdown")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand search" }));
    expect(document.querySelector(".search-dropdown")).toBeTruthy();
    expect(document.querySelector(".search-drop-backdrop")).toBeTruthy();
    expect(document.querySelector(".search-editor-input")).toBeTruthy();
    fireEvent.mouseDown(
      document.querySelector(".search-drop-backdrop") as Element,
    );
    expect(document.querySelector(".search-dropdown")).toBeNull();
  });

  it("submits caseSensitive and regex when modifiers are toggled", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("needle");
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    clickSearch();
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (entry) =>
          typeof entry[0] === "string" && entry[0].includes("/api/search"),
      );
      expect(calls.length).toBeGreaterThan(0);
      const raw = calls[calls.length - 1]?.[1]?.body;
      const body = JSON.parse(raw as string) as {
        caseSensitive: boolean;
        regex: boolean;
      };
      expect(body.caseSensitive).toBe(true);
      expect(body.regex).toBe(true);
    });
  });

  it("opens hotkeys help modal on ? key", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    fireEvent.keyDown(window, { key: "?" });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
    });
  });

  it("toggles between grouped and flat result views", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("hit", HIT_B),
        sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".result-group-header")).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle("Flat View"));
    await waitFor(() => {
      expect(document.querySelector(".result-group-header")).toBeNull();
      expect(document.querySelector(".result-virtual-row")).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle("Group by File"));
    await waitFor(() => {
      expect(document.querySelector(".result-group-header")).toBeTruthy();
    });
  });
});

function searchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    (entry) => typeof entry[0] === "string" && entry[0].includes("/api/search"),
  );
}

function searchCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return searchCalls(fetchMock).length;
}

function lastSearchBody(fetchMock: ReturnType<typeof vi.fn>): {
  query: string;
  regex: boolean;
} {
  const raw = searchCalls(fetchMock).at(-1)?.[1]?.body;
  if (typeof raw !== "string") {
    throw new Error("missing search body");
  }
  return JSON.parse(raw) as { query: string; regex: boolean };
}
