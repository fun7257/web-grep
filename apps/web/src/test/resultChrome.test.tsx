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
import { TREE_OPEN_KEY } from "../components/FileTree.tsx";

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
    previewChunk: 160,
    previewChunkMax: 400,
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

function openSse(): {
  response: Response;
  push: (chunk: string) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const pending: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
      for (const chunk of pending.splice(0)) {
        controller.enqueue(encoder.encode(chunk));
      }
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push: (chunk: string): void => {
      if (controller === undefined) {
        pending.push(chunk);
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  };
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

function mockFetch(
  search: (init?: RequestInit) => Promise<Response> | Response,
  auth?: { engine?: "rg" | "none" },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/api/auth/status")) {
      return Promise.resolve(jsonResponse(200, { authRequired: false }));
    }
    if (url.includes("/api/meta")) {
      return Promise.resolve(
        jsonResponse(200, { ...META, engine: auth?.engine ?? META.engine }),
      );
    }
    if (url.includes("/api/tree")) {
      const asked = new URL(url, "http://x").searchParams.get("path") ?? "";
      return Promise.resolve(
        jsonResponse(200, { path: asked, entries: [], truncated: false }),
      );
    }
    if (url.includes("/api/search")) {
      return Promise.resolve(search(init));
    }
    if (url.includes("/api/file")) {
      return Promise.resolve(
        jsonResponse(200, {
          path: "src/a.ts",
          startLine: 1,
          lineCount: 1,
          truncated: false,
          binary: false,
          eof: true,
          lines: [{ n: 1, text: "hello world" }],
        }),
      );
    }
    return Promise.resolve(
      jsonResponse(404, { code: "INTERNAL", message: "not found" }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type SearchBody = {
  query: string;
  mtimeAfter?: number;
  globExclude: string[];
};

function searchBodies(fetchMock: ReturnType<typeof vi.fn>): SearchBody[] {
  const bodies: SearchBody[] = [];
  for (const call of fetchMock.mock.calls) {
    const url = requestUrl(call[0] as RequestInfo | URL);
    if (!url.includes("/api/search")) {
      continue;
    }
    const init = call[1] as RequestInit | undefined;
    if (typeof init?.body !== "string") {
      continue;
    }
    bodies.push(JSON.parse(init.body) as SearchBody);
  }
  return bodies;
}

function typeQuery(value: string): void {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
}

function clickSearch(): void {
  const go = document.querySelector(".search-go") as HTMLButtonElement;
  if (go.classList.contains("cancel")) {
    return;
  }
  fireEvent.click(go);
}

function nums(): string[] {
  return [...document.querySelectorAll(".pane-head-summary b.num")].map(
    (node) => node.textContent ?? "",
  );
}

describe("result chrome", () => {
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

  it("shows idle shortcut tips and no fold control", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Type a keyword to search")).toBeTruthy();
    });
    expect(document.querySelector(".empty-idle .state-art")).toBeTruthy();
    expect(document.querySelector(".empty-tips .kbd")?.textContent).toBe("/");
    expect(screen.getByText("Focus the search box")).toBeTruthy();
    expect(screen.getByText("Add another filter")).toBeTruthy();
    expect(screen.getByText("Case / whole word / regex")).toBeTruthy();
    expect(screen.getByText("All shortcuts")).toBeTruthy();
    expect(document.querySelector(".result-fold-all")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Clear time range" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear excludes" })).toBeNull();
  });

  it("shows a bold running summary and hides the result-bar cancel", async () => {
    const sse = openSse();
    mockFetch(() => sse.response);
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".result-spin")).toBeTruthy();
    });
    expect(document.querySelector(".result-progress")).toBeTruthy();
    expect(document.querySelector(".status-cancel")).toBeNull();
    expect(document.querySelector(".pane-head-title")?.textContent).toBe(
      "Searching…",
    );
    sse.push(sseEvent("progress", { files: 12, matches: 3 }));
    await waitFor(() => {
      expect(document.querySelector(".pane-head-summary")?.textContent).toBe(
        "scanned 12 files · 3 hits",
      );
    });
    expect(nums()).toEqual(["12", "3"]);
  });

  it("bolds match and file counts and splits the file path", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent(
          "done",
          donePayload({ matchCount: 41, fileCount: 15, elapsedMs: 42 }),
        ),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".pane-head-summary")?.textContent).toBe(
        "41 matches · 15 files · 42 ms",
      );
    });
    expect(nums()).toEqual(["41", "15"]);
    const path = document.querySelector(
      '[data-file-path="src/a.ts"] .result-group-path',
    );
    expect(path?.textContent).toBe("src/a.ts");
    expect(path?.querySelector(".result-group-dir")?.textContent).toBe("src/");
    expect(path?.querySelector(".result-group-name")?.textContent).toBe("a.ts");
    expect(document.querySelector(".result-log.selected")).toBeTruthy();
    expect(document.querySelector(".pane-head .result-fold-all")).toBeTruthy();
  });

  it("hides the fold control when nothing matched", async () => {
    mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    typeQuery("zzz");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByText("No matches")).toBeTruthy();
    });
    expect(document.querySelector(".empty-idle .state-art")).toBeTruthy();
    expect(nums()).toEqual(["0", "0"]);
    expect(document.querySelector(".result-fold-all")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Clear time range" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear excludes" })).toBeNull();
  });

  it("clears the time range and searches again without mtimeAfter", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    typeQuery("zzz");
    clickSearch();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear time range" }),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Clear excludes" })).toBeNull();
    const first = searchBodies(fetchMock).at(-1);
    expect(first?.mtimeAfter).toEqual(expect.any(Number));
    fireEvent.click(screen.getByRole("button", { name: "Clear time range" }));
    await waitFor(() => {
      const last = searchBodies(fetchMock).at(-1);
      expect(last).toBeDefined();
      expect(last).not.toBe(first);
    });
    const last = searchBodies(fetchMock).at(-1);
    expect(last).not.toHaveProperty("mtimeAfter");
    expect(last?.query).toBe("zzz");
    expect(last?.globExclude).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Clear time range" }),
    ).toBeNull();
  });

  it("clears excludes and searches again with an empty globExclude", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Exclude" }), {
      target: { value: "*.log" },
    });
    typeQuery("zzz");
    clickSearch();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear excludes" }),
      ).toBeTruthy();
    });
    expect(searchBodies(fetchMock).at(-1)?.globExclude).toEqual(["*.log"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear excludes" }));
    await waitFor(() => {
      expect(searchBodies(fetchMock).at(-1)?.globExclude).toEqual([]);
    });
    expect(searchBodies(fetchMock).at(-1)).not.toHaveProperty("mtimeAfter");
    expect(
      (screen.getByRole("textbox", { name: "Exclude" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("keeps excludes when only the time range is cleared", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Exclude" }), {
      target: { value: "*.log" },
    });
    typeQuery("zzz");
    clickSearch();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear time range" }),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Clear excludes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear time range" }));
    await waitFor(() => {
      const last = searchBodies(fetchMock).at(-1);
      expect(last).not.toHaveProperty("mtimeAfter");
      expect(last?.globExclude).toEqual(["*.log"]);
    });
  });

  it("focuses the exclude field from the truncation banner", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent(
          "done",
          donePayload({ matchCount: 1, fileCount: 1, truncated: true }),
        ),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    const narrow = await screen.findByRole("button", { name: "Narrow scope" });
    fireEvent.click(narrow);
    expect(document.activeElement).toBe(
      document.querySelector(".exclude-chip-input"),
    );
  });

  it("opens a collapsed tree before focusing the exclude field", async () => {
    localStorage.setItem(TREE_OPEN_KEY, "0");
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent(
          "done",
          donePayload({ matchCount: 1, fileCount: 1, truncated: true }),
        ),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    const narrow = await screen.findByRole("button", { name: "Narrow scope" });
    expect(document.querySelector(".exclude-chip-input")).toBeNull();
    fireEvent.click(narrow);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector(".exclude-chip-input"),
      );
    });
  });

  it("opens collapsed scope filters before focusing the exclude field", async () => {
    localStorage.setItem("web-grep.treeFilters.v1", "0");
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent(
          "done",
          donePayload({ matchCount: 1, fileCount: 1, truncated: true }),
        ),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    const narrow = await screen.findByRole("button", { name: "Narrow scope" });
    expect(document.querySelector(".exclude-chip-input")).toBeNull();
    fireEvent.click(narrow);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector(".exclude-chip-input"),
      );
    });
  });

  it("retries a timed-out search with the same request", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent(
          "done",
          donePayload({ matchCount: 1, fileCount: 1, timedOut: true }),
        ),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    const retry = await screen.findByRole("button", { name: "Retry" });
    const first = JSON.stringify(searchBodies(fetchMock).at(-1));
    fireEvent.click(retry);
    await waitFor(() => {
      expect(searchBodies(fetchMock)).toHaveLength(2);
    });
    expect(JSON.stringify(searchBodies(fetchMock)[1])).toBe(first);
  });

  it("reruns the last search from the cancelled page", async () => {
    const fetchMock = mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const again = await screen.findByRole("button", { name: "Search again" });
    expect(document.querySelector(".state-view.tone-warn")).toBeTruthy();
    expect(screen.getByText("CANCELLED")).toBeTruthy();
    const first = JSON.stringify(searchBodies(fetchMock)[0]);
    fireEvent.click(again);
    await waitFor(() => {
      expect(searchBodies(fetchMock)).toHaveLength(2);
    });
    expect(JSON.stringify(searchBodies(fetchMock)[1])).toBe(first);
  });

  it("retries a busy search with the same request", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(429, { code: "BUSY", message: "too many searches" }),
    );
    render(<App />);
    typeQuery("busyq");
    clickSearch();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("BUSY")).toBeTruthy();
    expect(document.querySelector(".state-view.tone-warn")).toBeTruthy();
    const first = JSON.stringify(searchBodies(fetchMock)[0]);
    fireEvent.click(retry);
    await waitFor(() => {
      expect(searchBodies(fetchMock)).toHaveLength(2);
    });
    expect(JSON.stringify(searchBodies(fetchMock)[1])).toBe(first);
  });

  it("shows the engine page without a recheck action", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]), {
      engine: "none",
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Search engine unavailable")).toBeTruthy();
    });
    expect(screen.getByText("ENGINE")).toBeTruthy();
    expect(document.querySelector(".state-view.tone-danger")).toBeTruthy();
    expect(document.querySelector(".state-btn")).toBeNull();
    expect(screen.queryByRole("button", { name: /recheck/i })).toBeNull();
  });

  it("uses the same state page when the sidebar is collapsed", async () => {
    localStorage.setItem(TREE_OPEN_KEY, "0");
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Sidebar collapsed")).toBeTruthy();
    });
    expect(document.querySelector(".state-view")).toBeTruthy();
    expect(document.querySelector(".empty-tips")).toBeNull();
  });
});
