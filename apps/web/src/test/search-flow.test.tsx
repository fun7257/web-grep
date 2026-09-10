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
  return {
    path,
    startLine: line,
    lineCount: 1,
    truncated: false,
    binary: false,
    lines: [{ n: line, text: `${path} line ${line}` }],
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

function fileCalls(
  fetchMock: ReturnType<typeof vi.fn>,
): { url: string; init?: RequestInit }[] {
  return fetchMock.mock.calls
    .filter((call) => requestUrl(call[0]).includes("/api/file"))
    .map((call) => ({ url: requestUrl(call[0]), init: call[1] }));
}

function typeQuery(value: string): void {
  fireEvent.change(
    screen.getByPlaceholderText("Search file contents (regex)"),
    {
      target: { value },
    },
  );
}

function clickSearch(): void {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
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
    expect(screen.getByText("src/a.ts:1")).toBeTruthy();
    expect(screen.getByText("src/b.ts:3")).toBeTruthy();
    const marks = document.querySelectorAll("mark");
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
      expect(screen.getByText("src/a.ts:1")).toBeTruthy();
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
      expect(screen.getByText("src/a.ts:1")).toBeTruthy();
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getByText("src/a.ts:1")).toBeTruthy();
  });

  it("sends a brace glob as one include pattern", async () => {
    const fetchMock = mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    fireEvent.change(screen.getByLabelText("Include glob"), {
      target: { value: "*.{ts,tsx}, *.md" },
    });
    clickSearch();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry) =>
          typeof entry[0] === "string" && entry[0].includes("/api/search"),
      );
      expect(call).toBeTruthy();
      const raw = call?.[1]?.body;
      expect(typeof raw).toBe("string");
      if (typeof raw !== "string") {
        return;
      }
      const body = JSON.parse(raw) as { globInclude: string[] };
      expect(body.globInclude).toEqual(["*.{ts,tsx}", "*.md"]);
    });
  });

  it("blurs the query on Escape when not running", () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    const input = screen.getByPlaceholderText("Search file contents (regex)");
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

  it("aborts the in-flight preview fetch on selection change and ignores a stale response", async () => {
    let finishFirst: ((res: Response) => void) | undefined;
    const firstPromise = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    let files = 0;
    const fetchMock = mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("hit", HIT_B),
          sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
        ]),
      (url) => {
        files += 1;
        if (files === 1) {
          return firstPromise;
        }
        return jsonResponse(200, fileWindowForUrl(url));
      },
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    await waitFor(() => {
      expect(fileCalls(fetchMock)).toHaveLength(1);
    });
    fireEvent.click(screen.getByText("src/b.ts:3"));
    await waitFor(() => {
      expect(screen.getByText("src/b.ts line 3")).toBeTruthy();
    });
    const first = fileCalls(fetchMock)[0];
    expect(first?.init?.signal?.aborted).toBe(true);
    finishFirst?.(
      jsonResponse(200, fileWindowForUrl("/api/file?path=src/a.ts&line=1")),
    );
    await waitFor(() => {
      expect(screen.getByText("src/b.ts line 3")).toBeTruthy();
    });
    expect(screen.queryByText("src/a.ts line 1")).toBeNull();
  });

  it("copies the selected relative path from the button and from ⌘C when the list is focused", async () => {
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
      expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("src/a.ts line 1")).toBeTruthy();
    });
    expect(
      document.querySelector(".preview-line.current")?.textContent,
    ).toMatch(/src\/a\.ts line 1/);
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    expect(writeText).toHaveBeenCalledWith("src/a.ts");

    writeText.mockClear();
    const query = screen.getByPlaceholderText("Search file contents (regex)");
    query.focus();
    fireEvent.keyDown(query, { key: "c", metaKey: true });
    expect(writeText).not.toHaveBeenCalled();

    const list = screen.getByRole("list");
    list.focus();
    fireEvent.keyDown(list, { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledWith("src/a.ts");
  });
});
