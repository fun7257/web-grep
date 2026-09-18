/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_STORAGE_KEY } from "../api/headers.ts";
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
  auth?: {
    authRequired?: boolean;
    treeEntries?: { name: string; path: string; dir: boolean }[];
    engine?: "rg" | "none";
  },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/api/auth/status")) {
      return Promise.resolve(
        jsonResponse(200, {
          authRequired: auth?.authRequired ?? false,
        }),
      );
    }
    if (url.includes("/api/auth/login")) {
      const raw = init?.body;
      let password = "";
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw) as { password?: string };
          password = parsed.password ?? "";
        } catch {
          password = "";
        }
      }
      if (password === "" || password === "wrong") {
        return Promise.resolve(
          jsonResponse(401, {
            code: "INVALID_AUTH",
            message: "invalid password",
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { token: "sess-abc" }));
    }
    if (url.includes("/api/meta")) {
      return Promise.resolve(
        jsonResponse(200, {
          ...META,
          engine: auth?.engine ?? META.engine,
        }),
      );
    }
    if (url.includes("/api/auth/logout")) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (url.includes("/api/count")) {
      return Promise.resolve(jsonResponse(200, { count: 1 }));
    }
    if (url.includes("/api/tree")) {
      if (auth?.authRequired === true) {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers?.Authorization !== "Bearer sess-abc") {
          return Promise.resolve(
            jsonResponse(401, {
              code: "UNAUTHORIZED",
              message: "missing or invalid session",
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            path: "",
            entries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
            truncated: false,
          }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, {
          path: "",
          entries: auth?.treeEntries ?? [],
          truncated: false,
        }),
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
  const go = document.querySelector(".search-go") as HTMLButtonElement;
  if (go.classList.contains("cancel")) {
    return;
  }
  fireEvent.click(go);
}

function treeName(name: string): HTMLElement {
  const node = [...document.querySelectorAll(".tree-name")].find(
    (el) => el.textContent === name,
  );
  if (node === undefined) {
    throw new Error(`missing tree name ${name}`);
  }
  return node as HTMLElement;
}

function openFilters(): void {
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
}

function addFilterField(): void {
  if (document.querySelector(".search-and-pop") === null) {
    openFilters();
  }
  fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
}

function locMatcher(label: string) {
  return (_content: string, node: Element | null): boolean =>
    node instanceof HTMLElement &&
    node.classList.contains("result-loc") &&
    (node.textContent ?? "") === label;
}

function fileRow(path: string): HTMLElement | null {
  return document.querySelector(`[data-file-path="${path}"]`);
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

  it("reloads the tree with mtimeAfter when a time range is selected", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    await waitFor(() => {
      expect(treeRequestUrls(fetchMock).length).toBeGreaterThan(0);
    });
    expect(
      treeRequestUrls(fetchMock).some((url) => url.includes("mtimeAfter=")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    await waitFor(() => {
      const treeUrls = fetchMock.mock.calls
        .map((call) => requestUrl(call[0] as RequestInfo))
        .filter((url) => url.includes("/api/tree") && url.includes("mtimeAfter="));
      expect(treeUrls.length).toBeGreaterThan(0);
    });
  });

  it("clears file picks when the time range changes", async () => {
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() => {
      expect(screen.getByText("0 selected")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Search selected" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Clear conditions" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("search selected files sends globInclude", async () => {
    let body = "";
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          body = init.body;
        }
        return sseResponse([sseEvent("done", donePayload())]);
      },
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(body).toMatch(/globInclude/);
    });
    const parsed = JSON.parse(body) as { globInclude?: string[] };
    expect(parsed.globInclude).toEqual(["ok.txt"]);
  });

  it("main search also constrains to picked files", async () => {
    let body = "";
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          body = init.body;
        }
        return sseResponse([sseEvent("done", donePayload())]);
      },
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(body).toMatch(/globInclude/);
    });
    const parsed = JSON.parse(body) as { globInclude?: string[] };
    expect(parsed.globInclude).toEqual(["ok.txt"]);
  });

  it("typing exclude does not filter the tree until enter or blur", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.log", path: "skip.log", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("*.test.ts") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "*.log" } });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
    expect(
      treeRequestUrls(fetchMock).some((url) => url.includes("exclude=")),
    ).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).not.toBe(input);
    await waitFor(() => {
      expect(
        treeRequestUrls(fetchMock).some((url) => url.includes("exclude=")),
      ).toBe(true);
    });
  });

  it("blurring the exclude box reloads the tree with exclude", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("*.test.ts") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "*.test.ts" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(
        treeRequestUrls(fetchMock).some((url) => url.includes("exclude=")),
      ).toBe(true);
    });
  });

  it("combined tree filter sends exclude before time", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    const input = screen.getByPlaceholderText("*.test.ts") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "*.log" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    await waitFor(() => {
      const urls = treeRequestUrls(fetchMock).filter(
        (url) => url.includes("exclude=") && url.includes("mtimeAfter="),
      );
      expect(urls.length).toBeGreaterThan(0);
      const last = urls.at(-1) ?? "";
      expect(last.indexOf("exclude=")).toBeGreaterThanOrEqual(0);
      expect(last.indexOf("exclude=")).toBeLessThan(last.indexOf("mtimeAfter="));
    });
  });

  it("applying exclude unchecks matching files and updates the selected count", async () => {
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.log", path: "skip.log", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    fireEvent.click(screen.getByText("skip.log"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    const exclude = screen.getByPlaceholderText("*.test.ts") as HTMLInputElement;
    fireEvent.change(exclude, { target: { value: "*.log" } });
    fireEvent.blur(exclude);
    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeTruthy();
    });
    expect(treeName("ok.txt").closest("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      treeName("skip.log").closest("button")?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("typed exclude sends globExclude and does not include selected files", async () => {
    let body = "";
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          body = init.body;
        }
        return sseResponse([sseEvent("done", donePayload())]);
      },
      undefined,
      {
        treeEntries: [{ name: "skip.txt", path: "skip.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("skip.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("skip.txt"));
    fireEvent.change(screen.getByPlaceholderText("*.test.ts"), {
      target: { value: "*.log" },
    });
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(body).toMatch(/globExclude/);
    });
    const parsed = JSON.parse(body) as {
      globInclude?: string[];
      globExclude?: string[];
    };
    expect(parsed.globInclude).toEqual(["skip.txt"]);
    expect(parsed.globExclude).toEqual(["*.log"]);
    expect(screen.queryByRole("button", { name: "Exclude selected" })).toBeNull();
    expect(screen.queryByPlaceholderText("*.ts, src/**")).toBeNull();
  });

  it("clearing conditions does not rerun search", async () => {
    const bodies: string[] = [];
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          bodies.push(init.body);
        }
        return sseResponse([sseEvent("done", donePayload())]);
      },
      undefined,
      {
        treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(bodies.length).toBe(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear conditions" }));
    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(bodies.length).toBe(1);
  });

  it("clear conditions resets picks, exclude, and time", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      {
        treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    const exclude = screen.getByPlaceholderText("*.test.ts") as HTMLInputElement;
    fireEvent.change(exclude, { target: { value: "*.log" } });
    fireEvent.blur(exclude);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    expect(screen.getByText("0 selected")).toBeTruthy();
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      const parsed = lastSearchRequest(fetchMock);
      expect(parsed.globExclude).toEqual(["*.log"]);
      expect(parsed.mtimeAfter).toBeGreaterThan(0);
    });
    const searchesBefore = fetchMock.mock.calls.filter((call) =>
      requestUrl(call[0] as RequestInfo).includes("/api/search"),
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "Clear conditions" }));
    expect(exclude.value).toBe("");
    expect(
      fetchMock.mock.calls.filter((call) =>
        requestUrl(call[0] as RequestInfo).includes("/api/search"),
      ).length,
    ).toBe(searchesBefore);
    expect(
      screen.getByRole("button", { name: "24h" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      (screen.getByRole("button", { name: "Clear conditions" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("does not search when a time range is clicked after results exist", async () => {
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
      expect(fileRow("src/a.ts")).toBeTruthy();
    });
    const searchesBefore = searchCallCount(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    expect(searchCallCount(fetchMock)).toBe(searchesBefore);
    clickSearch();
    await waitFor(() => {
      expect(searchCallCount(fetchMock)).toBe(searchesBefore + 1);
    });
    expect(lastSearchRequest(fetchMock).mtimeAfter).toBeGreaterThan(0);
  });

  it("sends mtimeAfter when a time range is selected", async () => {
    let body = "";
    mockFetch((init) => {
      if (typeof init?.body === "string") {
        body = init.body;
      }
      return sseResponse([sseEvent("done", donePayload())]);
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(body).toMatch(/mtimeAfter/);
    });
    const parsed = JSON.parse(body) as { mtimeAfter?: number };
    expect(parsed.mtimeAfter).toBeGreaterThan(Date.now() - 25 * 3_600_000);
    expect(parsed.mtimeAfter).toBeLessThanOrEqual(Date.now());
  });

  it("increments the search-count badge once per executed search", async () => {
    let n = 0;
    mockFetch(() => {
      n += 1;
      return sseResponse([
        sseEvent("meta", {
          searchId: "550e8400-e29b-41d4-a716-446655440000",
          engine: "rg",
          searchCount: n,
        }),
        sseEvent("done", donePayload()),
      ]);
    });
    render(<App />);
    expect(screen.getByTitle("0 searches run")).toBeTruthy();
    typeQuery("one");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByTitle("1 searches run")).toBeTruthy();
    });
    typeQuery("two");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByTitle("2 searches run")).toBeTruthy();
    });
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
      expect(fileRow("src/a.ts")).toBeTruthy();
      expect(fileRow("src/b.ts")).toBeTruthy();
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(getLoc("src/a.ts:1")).toBeTruthy();
    expect(
      document.querySelector(".result-log .result-text")?.textContent,
    ).toContain("hello world");
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
    expect(document.querySelector(".empty-idle .idle-mark")).toBeTruthy();
  });

  it("shows cancelled after abort", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    clickSearch();
    const abortBtn = screen.getAllByRole("button", { name: "Cancel" })[0];
    expect(abortBtn).toBeTruthy();
    fireEvent.click(abortBtn as HTMLElement);
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
      expect(fileRow("src/a.ts")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /Search engine unavailable/,
    );
    expect(screen.getByRole("alert").textContent).not.toMatch(/ripgrep failed/);
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
    expect(screen.getByRole("dialog").textContent).toMatch(/Sign in/);
  });

  it("persists a submitted token, closes login, and sends bearer headers", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    const dialog = await screen.findByRole("dialog");
    const pass = dialog.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;
    fireEvent.change(pass, { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("sess-abc");
      expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const authed = fetchMock.mock.calls.filter((entry) => {
      const headers = entry[1]?.headers as Record<string, string> | undefined;
      return headers?.Authorization === "Bearer sess-abc";
    });
    expect(authed.length).toBeGreaterThan(0);
    const headers = authed[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-Web-Grep-Token"]).toBe("sess-abc");
    expect(headers.Authorization).toBe("Bearer sess-abc");
  });

  it("loads the tree after login and logs out from the tree footer", async () => {
    mockFetch(
      () =>
        jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "missing or invalid session",
        }),
      undefined,
      { authRequired: true },
    );
    render(<App />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('input[name="password"]') as Element, {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
      expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.queryByText("ok.txt")).toBeNull();
  });

  it("does not persist or close on empty login submit", async () => {
    mockFetch(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    const dialog = await screen.findByRole("dialog");
    fireEvent.submit(dialog);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("unchecked remember keeps the token in sessionStorage", async () => {
    mockFetch(() =>
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "missing or invalid token",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Remember password"));
    fireEvent.change(dialog.querySelector('input[name="password"]') as Element, {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("sess-abc");
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("does not open login on FORBIDDEN_HOST", async () => {
    mockFetch(() =>
      jsonResponse(403, {
        code: "FORBIDDEN_HOST",
        message: "Host not allowed; set WEB_GREP_PUBLIC_HOST",
      }),
    );
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(screen.getAllByText(/Host not allowed/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
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
      expect(fileRow("src/a.ts")).toBeTruthy();
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(fileRow("src/a.ts")).toBeTruthy();
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
    const fetchMock = mockFetch(() =>
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
      expect(fileRow("src/a.ts")).toBeTruthy();
      expect(fileRow("src/b.ts")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        document.querySelector(".preview-pane .preview-line.current")
          ?.textContent,
      ).toMatch(/hello world/);
    });
    expect(
      document.querySelector(".preview-pane .preview-text mark")?.textContent,
    ).toBe("hello");
    expect(
      document.querySelector(".preview-pane .preview-text mark")?.className,
    ).toContain("hl-0");
    expect(
      document.querySelectorAll(".preview-pane .preview-line"),
    ).toHaveLength(1);
    expect(document.querySelector(".result-virtual-row")).toBeTruthy();
    const searchesAfterLoad = searchCallCount(fetchMock);
    fireEvent.click(getLoc("src/b.ts:3"));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-pane .preview-line.current")
          ?.textContent,
      ).toMatch(/hello there/);
    });
    expect(
      document.querySelectorAll(".preview-pane .preview-line"),
    ).toHaveLength(1);
    expect(searchCallCount(fetchMock)).toBe(searchesAfterLoad);
  });

  it("opens a context modal with surrounding file lines", async () => {
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
      expect(screen.getByRole("button", { name: "Context" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(dialog.textContent).toMatch(/src\/a\.ts line 1/);
    });
    expect(dialog.querySelectorAll(".preview-line").length).toBeGreaterThan(1);
    expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
      /line 1/,
    );
    expect(dialog.querySelector(".preview-find")).toBeNull();
    const goto = screen.getByLabelText("Go to line") as HTMLInputElement;
    expect(goto).toBeTruthy();
    fireEvent.change(goto, { target: { value: "5" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /src\/a\.ts line 5/,
      );
    });
    expect(document.querySelector(".app-dimmed")).toBeTruthy();
  });

  it("opens a tree file in the preview pane from line 1", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-browse .preview-line")?.textContent,
      ).toMatch(/ok\.txt line 1/);
    });
    expect(document.querySelector(".preview-browse mark")).toBeNull();
    const fileUrls = fetchMock.mock.calls
      .map((call) => requestUrl(call[0] as RequestInfo))
      .filter((url) => url.includes("/api/file"));
    expect(fileUrls.some((url) => url.includes("from=1"))).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
    expect(screen.getByText("0 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    expect(screen.getByLabelText("Go to line")).toBeTruthy();
    expect(dialog.querySelectorAll(".preview-line").length).toBeGreaterThan(0);
  });

  it("jumps to a line in the tree file preview", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-browse .preview-line")?.textContent,
      ).toMatch(/ok\.txt line 1/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line")?.textContent).toMatch(
        /ok\.txt line 1/,
      );
    });
    const goto = screen.getByLabelText("Go to line") as HTMLInputElement;
    fireEvent.change(goto, { target: { value: "5" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 5/,
      );
    });
    fireEvent.change(goto, { target: { value: "50" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 50/,
      );
    });
    const fileUrls = fetchMock.mock.calls
      .map((call) => requestUrl(call[0] as RequestInfo))
      .filter((url) => url.includes("/api/file"));
    expect(fileUrls.some((url) => /from=50(?:&|$)/.test(url))).toBe(true);
  });

  it("prepends earlier lines after a tree preview jump", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-browse .preview-line")?.textContent,
      ).toMatch(/ok\.txt line 1/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line")?.textContent).toMatch(
        /ok\.txt line 1/,
      );
    });
    const goto = screen.getByLabelText("Go to line") as HTMLInputElement;
    fireEvent.change(goto, { target: { value: "50" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 50/,
      );
    });
    const scroller = dialog.querySelector(".context-lines");
    expect(scroller).toBeTruthy();
    fireEvent.wheel(scroller as HTMLElement, { deltaY: -120 });
    await waitFor(() => {
      expect(dialog.textContent).toMatch(/ok\.txt line 1/);
      expect(dialog.textContent).toMatch(/ok\.txt line 50/);
    });
    const fileUrls = fetchMock.mock.calls
      .map((call) => requestUrl(call[0] as RequestInfo))
      .filter((url) => url.includes("/api/file"));
    expect(
      fileUrls.some((url) => {
        const from = new URL(url, "http://localhost").searchParams.get("from");
        return from !== null && Number(from) < 50;
      }),
    ).toBe(true);
  });

  it("reopens a tree file from line 1 after a jump", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(document.querySelector(".preview-browse .preview-line")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    const goto = await screen.findByLabelText("Go to line");
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line")).toBeTruthy();
    });
    fireEvent.change(goto, { target: { value: "50" } });
    fireEvent.submit((goto as HTMLInputElement).closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 50/,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-browse .preview-line")?.textContent,
      ).toMatch(/ok\.txt line 1/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const again = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(again.textContent).toMatch(/ok\.txt line 1/);
    });
    expect(again.querySelector(".preview-line.current")?.textContent ?? "").not.toMatch(
      /ok\.txt line 50/,
    );
    const afterClose = fetchMock.mock.calls
      .map((call) => requestUrl(call[0] as RequestInfo))
      .filter((url) => url.includes("/api/file"));
    expect(afterClose.filter((url) => url.includes("from=1")).length).toBeGreaterThan(
      1,
    );
  });

  it("shows an empty state when the tree file has no content", async () => {
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      () =>
        jsonResponse(200, {
          path: "empty.txt",
          startLine: 1,
          lineCount: 0,
          truncated: false,
          binary: false,
          eof: true,
          lines: [],
        }),
      { treeEntries: [{ name: "empty.txt", path: "empty.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("empty.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(screen.getByText("This file is empty")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(dialog.querySelector(".context-empty")?.textContent).toBe(
        "This file is empty",
      );
    });
    expect(
      (screen.getByLabelText("Go to line") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("clamps a missing line to the end of the tree file preview", async () => {
    const lastLine = 8;
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      (url) => {
        const parsed = new URL(url, "http://localhost");
        const path = parsed.searchParams.get("path") ?? "ok.txt";
        const tail = parsed.searchParams.get("tail") === "1";
        if (tail) {
          const lines = [];
          for (let n = Math.max(1, lastLine - 2); n <= lastLine; n++) {
            lines.push({ n, text: `${path} line ${n}` });
          }
          return jsonResponse(200, {
            path,
            startLine: lines[0]?.n ?? lastLine,
            lineCount: lines.length,
            truncated: false,
            binary: false,
            eof: true,
            lines,
          });
        }
        const from = Number(parsed.searchParams.get("from") ?? "1");
        if (from > lastLine) {
          return jsonResponse(200, {
            path,
            startLine: from,
            lineCount: 0,
            truncated: false,
            binary: false,
            eof: true,
            lines: [],
          });
        }
        const count = Number(parsed.searchParams.get("count") ?? "160");
        const last = Math.min(from + Math.min(count, 8) - 1, lastLine);
        const lines = [];
        for (let n = from; n <= last; n++) {
          lines.push({ n, text: `${path} line ${n}` });
        }
        return jsonResponse(200, {
          path,
          startLine: from,
          lineCount: lines.length,
          truncated: false,
          binary: false,
          eof: last >= lastLine,
          lines,
        });
      },
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(
        document.querySelector(".preview-browse .preview-line")?.textContent,
      ).toMatch(/ok\.txt line 1/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line")?.textContent).toMatch(
        /ok\.txt line 1/,
      );
    });
    const goto = screen.getByLabelText("Go to line") as HTMLInputElement;
    fireEvent.change(goto, { target: { value: "50" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(screen.getByText("No line 50 · jumped to 8")).toBeTruthy();
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 8/,
      );
    });
    expect(goto.value).toBe("8");
    fireEvent.change(goto, { target: { value: "3" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(dialog.querySelector(".preview-line.current")?.textContent).toMatch(
        /ok\.txt line 3/,
      );
    });
    expect(screen.queryByText(/No line 50/)).toBeNull();
  });

  it("rejects an invalid line number in the tree file preview", async () => {
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    await waitFor(() => {
      expect(document.querySelector(".preview-browse")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    await screen.findByRole("dialog", { name: "Context" });
    const goto = screen.getByLabelText("Go to line") as HTMLInputElement;
    fireEvent.change(goto, { target: { value: "abc" } });
    fireEvent.submit(goto.closest("form") as HTMLFormElement);
    expect(screen.getByText("Enter a valid line number")).toBeTruthy();
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
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
    expect(linkInput?.value).toContain("q=hello");
    expect(new URL(linkInput?.value ?? "").searchParams.get("p")).toBe(
      "src/a.ts",
    );
    expect(linkInput?.value).toContain("n=1");
    fireEvent.click(screen.getByRole("button", { name: "Copy rg command" }));
    expect(writeText).toHaveBeenCalledWith(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(linkInput?.value);
  });

  it("share rg command uses find -mtime for the selected time range", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const rgInput = screen
      .getByRole("dialog", { name: "Share" })
      .querySelector("input") as HTMLInputElement | null;
    expect(rgInput?.value).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
  });

  it("share link and rg command carry the full file and advanced options", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(screen.getByRole("button", { name: "\\b" }));
    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    fireEvent.change(screen.getByPlaceholderText("*.test.ts"), {
      target: { value: "*.test.ts" },
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share" });
    const rgInput = dialog.querySelectorAll(
      "input",
    )[0] as HTMLInputElement | null;
    const linkInput = dialog.querySelectorAll(
      "input",
    )[1] as HTMLInputElement | null;
    expect(rgInput?.value).toBe(
      "rg -n -s -w --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
    const shared = new URL(linkInput?.value ?? "");
    expect(shared.searchParams.get("q")).toBe("hello");
    expect(shared.searchParams.get("p")).toBe("src/a.ts");
    expect(shared.searchParams.get("n")).toBe("1");
    expect(shared.searchParams.get("s")).toBe("1");
    expect(shared.searchParams.get("w")).toBe("1");
    expect(shared.searchParams.get("r")).toBe("1");
    expect(shared.searchParams.get("i")).toBeNull();
    expect(shared.searchParams.get("x")).toBe("*.test.ts");
  });

  it("share link reads live tree picks and advanced options from the UI", async () => {
    mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]),
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    typeQuery("hello");
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(screen.getByRole("button", { name: "\\b" }));
    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    fireEvent.change(screen.getByPlaceholderText("*.test.ts"), {
      target: { value: "*.test.ts" },
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share" });
    const rgInput = dialog.querySelectorAll(
      "input",
    )[0] as HTMLInputElement | null;
    const linkInput = dialog.querySelectorAll(
      "input",
    )[1] as HTMLInputElement | null;
    expect(rgInput?.value).toBe(
      "rg -n -s -w --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
    const shared = new URL(linkInput?.value ?? "");
    expect(shared.searchParams.get("q")).toBe("hello");
    expect(shared.searchParams.get("p")).toBe("src/a.ts");
    expect(shared.searchParams.getAll("f")).toEqual(["ok.txt"]);
    expect(shared.searchParams.get("s")).toBe("1");
    expect(shared.searchParams.get("w")).toBe("1");
    expect(shared.searchParams.get("r")).toBe("1");
    expect(shared.searchParams.get("i")).toBeNull();
    expect(shared.searchParams.get("k")).toBeNull();
    expect(shared.searchParams.get("x")).toBe("*.test.ts");
    expect(window.location.search).toContain("f=ok.txt");
    expect(window.location.search).not.toContain("i=");
  });

  it("share link and rg command carry AND terms", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    addFilterField();
    fireEvent.change(await screen.findByRole("textbox", { name: "Add filter" }), {
      target: { value: "world" },
    });
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share" });
    const rgInput = dialog.querySelectorAll("input")[0] as HTMLInputElement;
    const linkInput = dialog.querySelectorAll("input")[1] as HTMLInputElement;
    const shared = new URL(linkInput.value);
    expect(shared.searchParams.getAll("q")).toEqual(["hello", "world"]);
    expect(rgInput.value).toContain(" -- hello /tmp/project/src/a.ts");
    expect(rgInput.value).toContain("| rg -F -i -- world");
    expect(rgInput.value).toContain("| rg '^1:' -r ''");
  });

  it("share link carries selected files as include picks", async () => {
    mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]),
      undefined,
      {
        treeEntries: [{ name: "skip.txt", path: "skip.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("skip.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("skip.txt"));
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share" });
    const rgInput = dialog.querySelectorAll("input")[0] as HTMLInputElement;
    const linkInput = dialog.querySelectorAll("input")[1] as HTMLInputElement;
    const shared = new URL(linkInput.value);
    expect(shared.searchParams.getAll("f")).toEqual(["skip.txt"]);
    expect(shared.searchParams.get("k")).toBeNull();
    expect(rgInput.value).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
  });

  it("share omits time from both links when the range is cleared", async () => {
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
    const rgInput = dialog.querySelectorAll("input")[0] as HTMLInputElement;
    const linkInput = dialog.querySelectorAll("input")[1] as HTMLInputElement;
    expect(new URL(linkInput.value).searchParams.get("t")).toBeNull();
    expect(rgInput.value).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^1:' -r ''",
    );
  });

  it("opens a shared link and selects the named hit", async () => {
    window.history.replaceState({}, "", "/?q=hello&p=src%2Fb.ts&n=3");
    let body = "";
    mockFetch((init) => {
      if (typeof init?.body === "string") {
        body = init.body;
      }
      return sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("hit", HIT_B),
        sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
      ]);
    });
    render(<App />);
    await waitFor(() => {
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current")?.textContent,
      ).toMatch(/hello there/);
    });
    const parsed = JSON.parse(body) as {
      globInclude?: string[];
      mtimeAfter?: number;
    };
    expect(parsed.globInclude).toEqual(["src/b.ts"]);
    expect(parsed.mtimeAfter).toBeUndefined();
  });

  it("opens a shared link with the full file and advanced options", async () => {
    window.history.replaceState(
      {},
      "",
      "/?q=hello&p=src%2Fb.ts&n=3&s=1&w=1&r=1&x=*.test.ts",
    );
    let body = "";
    mockFetch((init) => {
      if (typeof init?.body === "string") {
        body = init.body;
      }
      return sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("hit", HIT_B),
        sseEvent("done", donePayload({ matchCount: 2, fileCount: 2 })),
      ]);
    });
    render(<App />);
    await waitFor(() => {
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Aa" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "\\b" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: ".*" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByPlaceholderText("*.ts, src/**")).toBeNull();
    expect(
      (screen.getByPlaceholderText("*.test.ts") as HTMLInputElement).value,
    ).toBe("*.test.ts");
    const parsed = JSON.parse(body) as {
      query: string;
      caseSensitive?: boolean;
      wordMatch?: boolean;
      regex?: boolean;
      globInclude?: string[];
      globAnd?: string[];
      globExclude?: string[];
    };
    expect(parsed.query).toBe("hello");
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.wordMatch).toBe(true);
    expect(parsed.regex).toBe(true);
    expect(parsed.globInclude).toEqual(["src/b.ts"]);
    expect(parsed.globAnd ?? []).toEqual([]);
    expect(parsed.globExclude).toEqual(["*.test.ts"]);
  });

  it("opens a shared link with tree picks restored from the UI", async () => {
    window.history.replaceState(
      {},
      "",
      "/?q=hello&f=ok.txt&s=1&w=1&r=1&x=*.test.ts&p=src%2Fa.ts&n=1",
    );
    let body = "";
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          body = init.body;
        }
        return sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]);
      },
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText("*.ts, src/**")).toBeNull();
    const parsed = JSON.parse(body) as {
      caseSensitive?: boolean;
      wordMatch?: boolean;
      regex?: boolean;
      globInclude?: string[];
      globAnd?: string[];
      globExclude?: string[];
    };
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.wordMatch).toBe(true);
    expect(parsed.regex).toBe(true);
    expect(parsed.globInclude).toEqual(["ok.txt"]);
    expect(parsed.globAnd ?? []).toEqual([]);
    expect(parsed.globExclude).toEqual(["*.test.ts"]);
  });

  it("opens a shared AND query with tree picks as include", async () => {
    window.history.replaceState(
      {},
      "",
      "/?q=hello&q=world&f=skip.txt&t=7d",
    );
    let body = "";
    mockFetch(
      (init) => {
        if (typeof init?.body === "string") {
          body = init.body;
        }
        return sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]);
      },
      undefined,
      {
        treeEntries: [{ name: "skip.txt", path: "skip.txt", dir: false }],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("1 selected")).toBeTruthy();
    });
    const parsed = JSON.parse(body) as {
      query: string;
      regex?: boolean;
      andTerms?: string[];
      globInclude?: string[];
      globExclude?: string[];
      mtimeAfter?: number;
    };
    expect(parsed.regex ?? false).toBe(false);
    expect(parsed.query).toBe("hello");
    expect(parsed.andTerms ?? []).toEqual([
      {
        query: "world",
        regex: false,
        caseSensitive: false,
        wordMatch: false,
      },
    ]);
    expect(parsed.globInclude).toEqual(["skip.txt"]);
    expect(parsed.globExclude ?? []).toEqual([]);
    expect(parsed.mtimeAfter).toBeGreaterThan(Date.now() - 8 * 86_400_000);
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
        document.querySelector(".preview-line.current .preview-text") ??
          document.querySelector(".preview-text"),
      ).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: "Search selection" }),
    ).toBeNull();
    const previewText =
      document.querySelector(".preview-line.current .preview-text") ??
      document.querySelector(".preview-text");
    expect(previewText).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(previewText as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.mouseUp(document.querySelector(".preview") as Element);
    await screen.findByRole("menuitem", {
      name: "Search selection",
    });
    expect(document.querySelector(".sel-menu")).toBeTruthy();
    fireEvent.mouseDown(previewText as Element);
    fireEvent.mouseUp(previewText as Element);
    await waitFor(() => {
      expect(document.querySelector(".sel-menu")).toBeNull();
    });
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.mouseUp(document.querySelector(".preview") as Element);
    const item = await screen.findByRole("menuitem", {
      name: "Search selection",
    });
    fireEvent.click(item);
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
      const body = JSON.parse(raw) as {
        query: string;
        regex: boolean;
        globInclude?: string[];
      };
      expect(body.regex).toBe(false);
      expect(body.query).toBe("hello world");
      expect(body.globInclude ?? []).toEqual([]);
    });
  });

  it("search selection stays inside tree-picked files", async () => {
    const fetchMock = mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]),
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current .preview-text") ??
          document.querySelector(".preview-text"),
      ).toBeTruthy();
    });
    const previewText =
      document.querySelector(".preview-line.current .preview-text") ??
      document.querySelector(".preview-text");
    const range = document.createRange();
    range.selectNodeContents(previewText as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.mouseUp(document.querySelector(".preview") as Element);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Search selection" }),
    );
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
      const body = JSON.parse(raw) as { globInclude?: string[] };
      expect(body.globInclude).toEqual(["ok.txt"]);
    });
  });

  it("search selection keeps case, word, regex, picks, and exclude", async () => {
    const fetchMock = mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]),
      undefined,
      {
        treeEntries: [
          { name: "ok.txt", path: "ok.txt", dir: false },
          { name: "skip.txt", path: "skip.txt", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("ok.txt")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ok.txt"));
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        document.querySelector(".preview-line.current .preview-text") ??
          document.querySelector(".preview-text"),
      ).toBeTruthy();
    });
    const first = lastSearchRequest(fetchMock);
    expect(first.caseSensitive ?? false).toBe(false);
    expect(first.wordMatch ?? false).toBe(false);
    expect(first.regex).toBe(false);
    expect(first.globAnd ?? []).toEqual([]);
    expect(first.globExclude ?? []).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(screen.getByRole("button", { name: "\\b" }));
    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    fireEvent.change(screen.getByPlaceholderText("*.test.ts"), {
      target: { value: "*.test.ts" },
    });
    const previewText =
      document.querySelector(".preview-line.current .preview-text") ??
      document.querySelector(".preview-text");
    const range = document.createRange();
    range.selectNodeContents(previewText as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.mouseUp(document.querySelector(".preview") as Element);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Search selection" }),
    );
    await waitFor(() => {
      expect(searchCallCount(fetchMock)).toBeGreaterThan(1);
    });
    const body = lastSearchRequest(fetchMock);
    expect(body.query).toBe("hello world");
    expect(body.caseSensitive).toBe(true);
    expect(body.wordMatch).toBe(true);
    expect(body.regex).toBe(true);
    expect(body.globInclude).toEqual(["ok.txt"]);
    expect(body.globAnd ?? []).toEqual([]);
    expect(body.globExclude).toEqual(["*.test.ts"]);
  });

  it("search selection without tree picks still sends exclude", async () => {
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
        document.querySelector(".preview-line.current .preview-text") ??
          document.querySelector(".preview-text"),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(screen.getByRole("button", { name: "\\b" }));
    fireEvent.click(screen.getByRole("button", { name: ".*" }));
    fireEvent.change(screen.getByPlaceholderText("*.test.ts"), {
      target: { value: "*.test.ts" },
    });
    const previewText =
      document.querySelector(".preview-line.current .preview-text") ??
      document.querySelector(".preview-text");
    const range = document.createRange();
    range.selectNodeContents(previewText as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.mouseUp(document.querySelector(".preview") as Element);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Search selection" }),
    );
    await waitFor(() => {
      expect(searchCallCount(fetchMock)).toBeGreaterThan(1);
    });
    const body = lastSearchRequest(fetchMock);
    expect(body.query).toBe("hello world");
    expect(body.caseSensitive).toBe(true);
    expect(body.wordMatch).toBe(true);
    expect(body.regex).toBe(true);
    expect(body.globInclude ?? []).toEqual([]);
    expect(body.globAnd ?? []).toEqual([]);
    expect(body.globExclude).toEqual(["*.test.ts"]);
  });

  it("does not add a condition when the last field is empty", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(screen.queryByRole("textbox", { name: "Add filter" })).toBeNull();
    openFilters();
    expect(
      (screen.getByRole("button", { name: "Add filter" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("Shift+Enter adds a filter even when the filter button is focused", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    const caret = screen.getByRole("button", { name: "Filters" });
    caret.focus();
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(
      await screen.findByRole("textbox", { name: "Add filter" }),
    ).toBeTruthy();
    expect(document.querySelector(".search-and-pop")).toBeTruthy();
    expect(document.querySelectorAll(".search-and-item")).toHaveLength(1);
  });

  it("Shift+Enter adds a new AND condition", async () => {
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
      expect(fileRow("src/a.ts")).toBeTruthy();
    });
    const searchesAfterFirst = searchCallCount(fetchMock);
    const box = screen.getByRole("searchbox");
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    expect(document.querySelector(".search-and-pop")).toBeTruthy();
    expect(searchCallCount(fetchMock)).toBe(searchesAfterFirst);
    fireEvent.change(extra, { target: { value: "world" } });
    clickSearch();
    await waitFor(() => {
      const body = lastSearchRequest(fetchMock);
      expect(body.query).toBe("hello");
      expect(body.regex ?? false).toBe(false);
      expect(body.andTerms ?? []).toEqual([
        {
          query: "world",
          regex: false,
          caseSensitive: false,
          wordMatch: false,
        },
      ]);
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
      expect(fileRow("src/a.ts")).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.querySelector(".preview-pane .preview-line.current")).toBeTruthy();
    });
    fireEvent.click(
      document.querySelector(".search-clear") as HTMLButtonElement,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(document.querySelectorAll(".q-chip")).toHaveLength(0);
    expect(queryLoc("src/a.ts:1")).toBeNull();
    expect(document.querySelector(".preview-pane .preview-line.current")).toBeNull();
    expect(document.querySelector(".empty-idle")).toBeTruthy();
    expect(document.querySelector(".preview-idle")).toBeTruthy();
  });

  it("treats spaces as part of the query", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    typeQuery("hello world");
    clickSearch();
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "hello world",
      );
    });
    expect(lastSearchBody(fetchMock).query).toBe("hello world");
    expect(lastSearchBody(fetchMock).regex).toBe(false);
  });

  it("lets each AND field set its own regex flag", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    fireEvent.change(extra, { target: { value: "world.*" } });
    const regexBtns = screen.getAllByRole("button", { name: ".*" });
    expect(regexBtns.length).toBeGreaterThan(1);
    fireEvent.click(regexBtns[1] as HTMLButtonElement);
    await waitFor(() => {
      const body = lastSearchRequest(fetchMock);
      expect(body.query).toBe("hello");
      expect(body.regex ?? false).toBe(false);
      expect(body.andTerms).toEqual([
        {
          query: "world.*",
          regex: true,
          caseSensitive: false,
          wordMatch: false,
        },
      ]);
    });
  });

  it("adds another search field for an AND condition", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    typeQuery("hello world");
    addFilterField();
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    fireEvent.change(extra, { target: { value: "timeout" } });
    clickSearch();
    await waitFor(() => {
      const body = lastSearchRequest(fetchMock);
      expect(body.query).toBe("hello world");
      expect(body.andTerms).toEqual([
        {
          query: "timeout",
          regex: false,
          caseSensitive: false,
          wordMatch: false,
        },
      ]);
      expect(body.regex ?? false).toBe(false);
    });
    expect(document.querySelector(".search-and-pop")).toBeNull();
    expect(document.querySelector(".search-add-count")?.textContent).toBe("1");
    expect(
      document.querySelector(".search-add-field")?.classList.contains("is-on"),
    ).toBe(true);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
      "hello world",
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(
      (screen.getByRole("textbox", { name: "Add filter" }) as HTMLInputElement)
        .value,
    ).toBe("timeout");
  });

  it("goes back to the previous search", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "hello",
      );
    });
    typeQuery("world");
    clickSearch();
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "world",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "hello",
      );
      expect(document.querySelectorAll(".q-chip")).toHaveLength(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "world",
      );
    });
  });

  it("opens search history from a button left of the search field", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("needle-hist");
    clickSearch();
    await waitFor(() => {
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
        "needle-hist",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Recent searches" }));
    expect(document.querySelector(".search-history-pop")).toBeTruthy();
    expect(screen.getByRole("button", { name: /needle-hist/ })).toBeTruthy();
    expect(document.querySelector(".search-and-pop")).toBeNull();
  });

  it("opens Filters from the filter button without adding a field", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    expect(document.querySelector(".search-and-pop")).toBeNull();
    expect(document.querySelector(".search-add-count")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(document.querySelector(".search-and-pop")).toBeTruthy();
    expect(document.querySelector(".search-drop-backdrop")).toBeTruthy();
    expect(screen.queryByText("Recent searches")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Add filter" }),
    ).toBeNull();
    expect(document.querySelector(".search-and-more")).toBeTruthy();
    expect(document.querySelector(".search-and-go")).toBeTruthy();
    fireEvent.mouseDown(
      document.querySelector(".search-drop-backdrop") as Element,
    );
    expect(document.querySelector(".search-and-pop")).toBeNull();
  });

  it("ignores empty AND fields when searching", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    typeQuery("hello");
    addFilterField();
    await screen.findByRole("textbox", { name: "Add filter" });
    expect(
      (document.querySelector(".search-and-more") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(document.querySelector(".search-and-more") as HTMLButtonElement);
    expect(document.querySelectorAll(".search-and-item")).toHaveLength(1);
    clickSearch();
    await waitFor(() => {
      expect(lastSearchBody(fetchMock).query).toBe("hello");
    });
    expect(lastSearchBody(fetchMock).regex).toBe(false);
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

  it("groups logs under filenames without collapsing", async () => {
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
      expect(fileRow("src/a.ts")).toBeTruthy();
      expect(fileRow("src/b.ts")).toBeTruthy();
      expect(getLoc("src/a.ts:1")).toBeTruthy();
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    expect(
      document.querySelector(".result-sticky-header .result-group-path")
        ?.textContent,
    ).toBe("src/a.ts");
    expect(screen.queryByRole("button", { name: "Back to files" })).toBeNull();
    expect(
      document.querySelector(".result-log .result-text")?.textContent,
    ).toContain("hello world");
    fireEvent.click(fileRow("src/a.ts") as HTMLElement);
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeNull();
    });
    expect(queryLoc("src/b.ts:3")).toBeTruthy();
    fireEvent.click(fileRow("src/a.ts") as HTMLElement);
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeTruthy();
    });
  });

  it("collapses and expands every file from the results pane", async () => {
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
      expect(getLoc("src/a.ts:1")).toBeTruthy();
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeNull();
      expect(queryLoc("src/b.ts:3")).toBeNull();
    });
    expect(fileRow("src/a.ts")).toBeTruthy();
    expect(fileRow("src/b.ts")).toBeTruthy();
    expect(document.querySelector(".pane-head .result-fold-all")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
    fireEvent.click(fileRow("src/a.ts") as HTMLElement);
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeNull();
    });
    expect(queryLoc("src/b.ts:3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeNull();
      expect(queryLoc("src/b.ts:3")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
      expect(getLoc("src/b.ts:3")).toBeTruthy();
    });
  });

  it("keeps both filenames after collapsing every group", async () => {
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
      expect(fileRow("src/a.ts")).toBeTruthy();
      expect(fileRow("src/b.ts")).toBeTruthy();
    });
    for (const path of ["src/a.ts", "src/b.ts"]) {
      for (const node of document.querySelectorAll(
        `[data-file-path="${path}"]`,
      )) {
        if (node.getAttribute("aria-expanded") === "true") {
          fireEvent.click(node);
        }
      }
    }
    await waitFor(() => {
      expect(queryLoc("src/a.ts:1")).toBeNull();
      expect(queryLoc("src/b.ts:3")).toBeNull();
    });
    const visibleNames = Array.from(
      document.querySelectorAll(".result-group-path"),
    )
      .filter((node) => node.closest(".is-stuck") === null)
      .map((node) => node.textContent);
    expect(visibleNames).toContain("src/a.ts");
    expect(visibleNames).toContain("src/b.ts");
    expect(new Set(visibleNames).size).toBe(2);
  });

  it("keeps the frozen filename after sorting the second file", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", {
          path: "src/a.ts",
          line: 1,
          text: "hello a-1",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/a.ts",
          line: 2,
          text: "hello a-2",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/b.ts",
          line: 10,
          text: "hello b-10",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/b.ts",
          line: 20,
          text: "hello b-20",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("done", donePayload({ matchCount: 4, fileCount: 2 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/b.ts:10")).toBeTruthy();
    });
    fireEvent.click(getLoc("src/b.ts:20"));
    const sortButtons = screen.getAllByRole("button", {
      name: "Line number ascending",
    });
    fireEvent.click(sortButtons[sortButtons.length - 1] as HTMLButtonElement);
    await waitFor(() => {
      expect(
        document.querySelector(".result-sticky-header .result-group-path")
          ?.textContent,
      ).toBeTruthy();
    });
    const frozen = document.querySelector(
      ".result-sticky-header .result-group-path",
    )?.textContent;
    expect(frozen === "src/a.ts" || frozen === "src/b.ts").toBe(true);
    expect(
      document.querySelector(".result-sticky-header")?.textContent,
    ).toMatch(/src\//);
  });

  it("shows long file logs without skip chips", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", {
          path: "src/a.ts",
          line: 1,
          text: `hello ${"x".repeat(4000)}`,
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        document.querySelector(".result-log .result-text")?.textContent,
      ).toMatch(/^hello /);
    });
    expect(document.querySelector(".result-log .result-snip-skip")).toBeNull();
  });

  it("sorts each file's hits by line number independently", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", {
          path: "src/a.ts",
          line: 1,
          text: "hello first",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/a.ts",
          line: 9,
          text: "hello last",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/b.ts",
          line: 2,
          text: "hello b-low",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("hit", {
          path: "src/b.ts",
          line: 8,
          text: "hello b-high",
          matches: [{ start: 0, end: 5 }],
        }),
        sseEvent("done", donePayload({ matchCount: 4, fileCount: 2 })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(getLoc("src/a.ts:1")).toBeTruthy();
    });
    const pills = () =>
      Array.from(document.querySelectorAll(".result-line-pill")).map(
        (node) => node.textContent,
      );
    expect(pills()).toEqual(["1", "9", "2", "8"]);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Line number ascending" })[0] as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(pills()).toEqual(["9", "1", "2", "8"]);
    });
    expect(
      document.querySelector(".result-log.selected .result-line-pill")
        ?.textContent,
    ).toBe("9");
    fireEvent.click(
      screen.getByRole("button", { name: "Line number ascending" }),
    );
    await waitFor(() => {
      expect(pills()).toEqual(["9", "1", "8", "2"]);
    });
  });

  it("keeps AuthDialog open on INVALID_AUTH and dims the main panes", async () => {
    mockFetch(
      () =>
        jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "missing or invalid session",
        }),
      undefined,
      { authRequired: true },
    );
    render(<App />);
    const dialog = await screen.findByRole("dialog");
    expect(document.querySelector(".app-dimmed")).toBeTruthy();
    fireEvent.change(dialog.querySelector('input[name="password"]') as Element, {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByText("Wrong password (INVALID_AUTH)")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (dialog.querySelector('input[name="password"]') as HTMLInputElement)
        .classList.contains("invalid"),
    ).toBe(true);
    expect(document.querySelector(".app-dimmed")).toBeTruthy();
  });

  it("turns Search into Cancel while running and shows progress meta", async () => {
    mockFetch((init) => neverSettle(init));
    render(<App />);
    typeQuery("needle");
    clickSearch();
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBeGreaterThan(0);
    });
    expect(document.querySelector(".search-go.cancel")).toBeTruthy();
    expect(document.querySelector(".status-cancel")).toBeTruthy();
    expect(document.querySelector(".pane-head-title")?.textContent).toBe(
      "Searching…",
    );
    const runningCancel = screen.getAllByRole("button", { name: "Cancel" })[0];
    expect(runningCancel).toBeTruthy();
    fireEvent.click(runningCancel as HTMLElement);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Cancelled/);
    });
    expect(screen.getByText("CANCELLED")).toBeTruthy();
  });

  it("stacks truncated above timedOut warn banners", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({
          matchCount: 1,
          fileCount: 1,
          truncated: true,
          timedOut: true,
        })),
      ]),
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelectorAll(".warn-banner")).toHaveLength(2);
    });
    const labels = [...document.querySelectorAll(".warn-label")].map(
      (node) => node.textContent,
    );
    expect(labels[0]).toMatch(/truncated/i);
    expect(labels[1]).toMatch(/Timed out/i);
  });

  it("shows BUSY and ENGINE empty-state codes", async () => {
    mockFetch(() =>
      jsonResponse(429, {
        code: "BUSY",
        message: "too many searches",
      }),
    );
    render(<App />);
    typeQuery("busyq");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByText("Search is busy, try again shortly")).toBeTruthy();
    });
    expect(screen.getByText("BUSY")).toBeTruthy();
    cleanup();
    mockFetch(() =>
      sseResponse([
        sseEvent("error", { code: "ENGINE", message: "ripgrep failed" }),
      ]),
    );
    render(<App />);
    typeQuery("eng");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".empty-title")?.textContent).toBe(
        "Search engine unavailable",
      );
    });
    expect(screen.getByText("ENGINE")).toBeTruthy();
    expect(screen.queryByText("ENGINE_UNSUPPORTED")).toBeNull();
    expect(
      (document.querySelector(".search-go") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("demotes raw engine stderr under the ENGINE empty-state title", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("error", { code: "ENGINE", message: "exit status 2" }),
      ]),
    );
    render(<App />);
    typeQuery("eng-stderr");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".empty-title")?.textContent).toBe(
        "Search engine unavailable",
      );
    });
    expect(document.querySelector(".empty-title")?.textContent).toBe(
      "Search engine unavailable",
    );
    expect(document.querySelector(".empty-code")?.textContent).toBe("ENGINE");
    expect(screen.queryByText("ENGINE_UNSUPPORTED")).toBeNull();
    const detail = document.querySelector(".empty-detail");
    expect(detail?.textContent).toMatch(/exit status 2/);
    expect(document.querySelector(".empty-title")?.textContent).not.toMatch(
      /exit status 2/,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Search engine unavailable/);
    expect(alert.textContent).not.toMatch(/exit status 2/);
    expect(
      (document.querySelector(".search-go") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables Search when meta.engine is none", async () => {
    const fetchMock = mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { engine: "none" },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Search engine unavailable")).toBeTruthy();
    });
    expect(screen.getByText("ENGINE")).toBeTruthy();
    expect(screen.queryByText("ENGINE_UNSUPPORTED")).toBeNull();
    const go = document.querySelector(".search-go") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    typeQuery("hello");
    clickSearch();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(
      fetchMock.mock.calls.some((call) =>
        requestUrl(call[0] as RequestInfo | URL).includes("/api/search"),
      ),
    ).toBe(false);
  });

  it("maps leftover ENGINE_UNSUPPORTED into ENGINE empty-state copy", async () => {
    mockFetch(() =>
      jsonResponse(503, {
        code: "ENGINE_UNSUPPORTED",
        message: "regex not supported",
      }),
    );
    render(<App />);
    typeQuery("eng-unsup");
    clickSearch();
    await waitFor(() => {
      expect(document.querySelector(".empty-title")?.textContent).toBe(
        "Search engine unavailable",
      );
    });
    expect(
      screen.getByText("The engine is not ready, so search is disabled"),
    ).toBeTruthy();
    expect(screen.getByText("ENGINE")).toBeTruthy();
    expect(screen.queryByText("ENGINE_UNSUPPORTED")).toBeNull();
    expect(document.querySelector(".empty-code")?.textContent).toBe("ENGINE");
    expect(
      (document.querySelector(".search-go") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows AuthDialog busy copy while login is in flight", async () => {
    mockFetch(
      () =>
        jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "missing or invalid session",
        }),
      undefined,
      { authRequired: true },
    );
    const inner = globalThis.fetch as typeof fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).includes("/api/auth/login")) {
        return neverSettle(init);
      }
      return inner(input, init);
    });
    render(<App />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('input[name="password"]') as Element, {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByText("Signing in…")).toBeTruthy();
    });
    expect(document.querySelector(".auth-spinner")).toBeTruthy();
    expect(
      (document.querySelector(".auth-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("retries the file tree after a load error", async () => {
    let failTree = true;
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    const inner = globalThis.fetch as typeof fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).includes("/api/tree") && failTree) {
        return Promise.resolve(
          jsonResponse(403, { code: "DENIED", message: "tree denied" }),
        );
      }
      return inner(input, init);
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("tree denied")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    failTree = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(treeName("ok.txt")).toBeTruthy();
    });
  });

  it("shows an option-flush info cue when modifiers re-search", async () => {
    mockFetch(() =>
      sseResponse([
        sseEvent("hit", HIT_A),
        sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
      ]),
    );
    render(<App />);
    typeQuery("needle");
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    await waitFor(() => {
      expect(screen.getByText("Re-searched with the new options")).toBeTruthy();
    });
    expect(document.querySelector(".info-cue")).toBeTruthy();
  });

  it("shows a pending path:line cue when restoring a share URL", async () => {
    window.history.replaceState({}, "", "/?q=hello&p=src%2Fb.ts&n=3");
    mockFetch((init) => neverSettle(init));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Pending select src/b.ts:3")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "Restored conditions from the share link and searched automatically",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Share link pending select src/b.ts:3"),
    ).toBeTruthy();
    expect(document.querySelectorAll(".info-cue").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("keeps the hit snippet and opens ContextModal for a tree file", async () => {
    mockFetch(
      () =>
        sseResponse([
          sseEvent("hit", HIT_A),
          sseEvent("done", donePayload({ matchCount: 1, fileCount: 1 })),
        ]),
      undefined,
      { treeEntries: [{ name: "ok.txt", path: "ok.txt", dir: false }] },
    );
    render(<App />);
    typeQuery("hello");
    clickSearch();
    await waitFor(() => {
      expect(
        document.querySelector(".preview-pane .preview-line.current")
          ?.textContent,
      ).toMatch(/hello world/);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    expect(document.querySelector(".app-dimmed")).toBeTruthy();
    expect(document.querySelector(".preview-browse")).toBeNull();
    expect(
      document.querySelector(".preview-pane .preview-line.current")
        ?.textContent,
    ).toMatch(/hello world/);
    expect(dialog.querySelector(".preview-find")).toBeNull();
  });

  it("counts only non-empty AND terms on the filter badge", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    expect(document.querySelector(".search-add-count")).toBeNull();
    fireEvent.change(extra, { target: { value: "   " } });
    expect(document.querySelector(".search-add-count")).toBeNull();
    fireEvent.change(extra, { target: { value: "world" } });
    expect(document.querySelector(".search-add-count")?.textContent).toBe("1");
    fireEvent.change(extra, { target: { value: "" } });
    expect(document.querySelector(".search-add-count")).toBeNull();
  });

  it("focuses the first empty AND input when the panel opens", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const first = await screen.findByRole("textbox", { name: "Add filter" });
    fireEvent.change(first, { target: { value: "filled" } });
    fireEvent.click(
      document.querySelector(".search-and-more") as HTMLButtonElement,
    );
    const boxes = screen.getAllByRole("textbox", { name: "Add filter" });
    expect(boxes).toHaveLength(2);
    fireEvent.mouseDown(
      document.querySelector(".search-drop-backdrop") as Element,
    );
    expect(document.querySelector(".search-and-pop")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const reopened = screen.getAllByRole("textbox", {
      name: "Add filter",
    }) as HTMLInputElement[];
    expect(reopened[1]?.value).toBe("");
    expect(document.activeElement).toBe(reopened[1]);
  });

  it("keeps unsubmitted AND drafts after Escape and click-outside", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    fireEvent.change(extra, { target: { value: "draft-term" } });
    fireEvent.keyDown(extra, { key: "Escape" });
    expect(document.querySelector(".search-and-pop")).toBeNull();
    expect(document.querySelector(".search-add-count")?.textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(
      (screen.getByRole("textbox", { name: "Add filter" }) as HTMLInputElement)
        .value,
    ).toBe("draft-term");
    fireEvent.mouseDown(
      document.querySelector(".search-drop-backdrop") as Element,
    );
    expect(document.querySelector(".search-and-pop")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(
      (screen.getByRole("textbox", { name: "Add filter" }) as HTMLInputElement)
        .value,
    ).toBe("draft-term");
  });

  it("submits the panel Search with the main query and non-empty andTerms", async () => {
    const fetchMock = mockFetch(() =>
      sseResponse([sseEvent("done", donePayload())]),
    );
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const extra = await screen.findByRole("textbox", { name: "Add filter" });
    fireEvent.change(extra, { target: { value: "world" } });
    fireEvent.click(
      document.querySelector(".search-and-more") as HTMLButtonElement,
    );
    expect(document.querySelectorAll(".search-and-item")).toHaveLength(2);
    fireEvent.click(
      document.querySelector(".search-and-go") as HTMLButtonElement,
    );
    await waitFor(() => {
      const body = lastSearchRequest(fetchMock);
      expect(body.query).toBe("hello");
      expect(body.andTerms).toEqual([
        {
          query: "world",
          regex: false,
          caseSensitive: false,
          wordMatch: false,
        },
      ]);
    });
    expect(document.querySelector(".search-and-pop")).toBeNull();
  });

  it("keeps long AND filter text readable in the scheme A row", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const extra = (await screen.findByRole("textbox", {
      name: "Add filter",
    })) as HTMLInputElement;
    const long = `filter-${"x".repeat(160)}-end`;
    fireEvent.change(extra, { target: { value: long } });
    expect(extra.value).toBe(long);
    expect(extra.title).toBe(long);
    expect(extra.closest(".search-and-field")).toBeTruthy();
    expect(
      extra.closest(".search-and-row")?.querySelector(".search-icon"),
    ).toBeNull();
    expect(document.querySelector(".search-and-pop .search-icon")).toBeNull();
    expect(
      document.querySelector(".search-and-mods .search-field-mods"),
    ).toBeTruthy();
    expect(document.querySelector(".search-and-mods .mod-btn")).toBeTruthy();
    expect(document.querySelector(".search-and-clear")).toBeTruthy();
    expect(
      document.querySelector(".search-and-pop")?.classList.contains(
        "search-and-block",
      ),
    ).toBe(true);
  });

  it("anchors the AND panel from the query field to the funnel inside the hits pane", async () => {
    const rect = (
      left: number,
      width: number,
      top = 8,
      height = 40,
    ): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        right: left + width,
        top,
        bottom: top + height,
        width,
        height,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("hits-pane")) {
          return rect(0, 360, 0, 640);
        }
        if (this.classList.contains("search-field")) {
          return rect(80, 180);
        }
        if (this.classList.contains("search-add-field")) {
          return rect(268, 40);
        }
        return rect(0, 0);
      });
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const panel = await waitFor(() => {
      const node = document.querySelector(
        ".search-and-pop",
      ) as HTMLElement | null;
      if (node === null || !node.classList.contains("is-anchored")) {
        throw new Error("panel not anchored");
      }
      return node;
    });
    expect(panel.style.width).toBe("228px");
    expect(panel.style.maxWidth).toBe("228px");
    expect(80 + 228).toBeLessThanOrEqual(360);
    spy.mockRestore();
  });

  it("clips a measured AND panel to the hits column instead of overflowing the preview", async () => {
    const rect = (
      left: number,
      width: number,
      top = 8,
      height = 40,
    ): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        right: left + width,
        top,
        bottom: top + height,
        width,
        height,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("hits-pane")) {
          return rect(0, 300, 0, 640);
        }
        if (this.classList.contains("search-field")) {
          return rect(80, 200);
        }
        if (this.classList.contains("search-add-field")) {
          return rect(400, 40);
        }
        return rect(0, 0);
      });
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("hello");
    addFilterField();
    const panel = await waitFor(() => {
      const node = document.querySelector(
        ".search-and-pop",
      ) as HTMLElement | null;
      if (node === null || !node.classList.contains("is-anchored")) {
        throw new Error("panel not anchored");
      }
      return node;
    });
    expect(panel.style.width).toBe("220px");
    expect(80 + 220).toBeLessThanOrEqual(300);
    spy.mockRestore();
  });

  it("caps AND fields at 16 and shows the limit hint", async () => {
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    typeQuery("term0");
    for (let i = 1; i <= 15; i++) {
      addFilterField();
      const boxes = screen.getAllByRole("textbox", { name: "Add filter" });
      fireEvent.change(boxes[boxes.length - 1] as HTMLInputElement, {
        target: { value: `term${i}` },
      });
    }
    expect(document.querySelectorAll(".search-and-item")).toHaveLength(15);
    expect(
      (document.querySelector(".search-and-more") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Up to 16 terms · empty rows are dropped on submit"),
    ).toBeTruthy();
  });

  it("shows binary and DENIED preview gap states when browsing a tree file", async () => {
    mockFetch(
      () => sseResponse([sseEvent("done", donePayload())]),
      (url) => {
        const path = new URL(url, "http://localhost").searchParams.get("path");
        if (path === "secret.bin") {
          return jsonResponse(403, {
            code: "DENIED",
            message: "path is denied",
          });
        }
        return jsonResponse(200, {
          path: "data.bin",
          startLine: 1,
          lineCount: 0,
          truncated: false,
          binary: true,
          eof: true,
          lines: [],
        });
      },
      {
        treeEntries: [
          { name: "data.bin", path: "data.bin", dir: false },
          { name: "secret.bin", path: "secret.bin", dir: false },
        ],
      },
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("data.bin")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Open file" })[0] as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByText("Binary file, cannot preview")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Open file" })[1] as HTMLButtonElement);
    await waitFor(() => {
      expect(screen.getByText("Path cannot be previewed")).toBeTruthy();
    });
    expect(screen.getByText("DENIED")).toBeTruthy();
  });

  it("shows L-RAIL chrome and collapsed empty copy when the tree is closed", async () => {
    localStorage.setItem("web-grep.treeOpen.v2", "0");
    localStorage.setItem("web-grep.timeRange.v2", "today");
    mockFetch(() => sseResponse([sseEvent("done", donePayload())]));
    render(<App />);
    const rail = document.querySelector(".tree-pane.collapsed.rail");
    expect(rail).toBeTruthy();
    expect(rail?.querySelector(".brand-mark")).toBeTruthy();
    expect(rail?.querySelector(".rail-expand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(document.querySelector(".rail-picked-badge")?.textContent).toMatch(
      /0/,
    );
    expect(document.querySelector(".rail-time-btn.is-active")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Toggle light/dark" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "中 / EN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.getByText("Sidebar collapsed")).toBeTruthy();
    expect(
      screen.getByText(
        "Click ▶ to expand; open/closed state is stored in localStorage",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() => {
      expect(document.querySelector(".tree-pane.collapsed")).toBeNull();
    });
    expect(screen.getByText("Type a keyword to search")).toBeTruthy();
    expect(localStorage.getItem("web-grep.treeOpen.v2")).toBe("1");
  });

  it("replaces no-match empty copy with the collapsed rail helper", async () => {
    mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    typeQuery("zzznotfoundxyz");
    clickSearch();
    await waitFor(() => {
      expect(screen.getByText("No matches")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(screen.getByText("Sidebar collapsed")).toBeTruthy();
    });
    expect(screen.queryByText("No matches")).toBeNull();
    expect(document.querySelector(".tree-pane.collapsed.rail")).toBeTruthy();
    expect(document.querySelector(".rail-expand")).toBeTruthy();
    expect(document.querySelector(".rail-time-btn")).toBeTruthy();
    expect(document.querySelector(".rail-logout")).toBeTruthy();
  });

  it("shows collapsed empty copy for a no-match share URL when the rail starts closed", async () => {
    localStorage.setItem("web-grep.treeOpen.v2", "0");
    window.history.replaceState({}, "", "/?q=zzznotfoundxyz");
    mockFetch(() =>
      sseResponse([sseEvent("done", donePayload({ matchCount: 0 }))]),
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Sidebar collapsed")).toBeTruthy();
    });
    expect(screen.queryByText("No matches")).toBeNull();
    expect(
      screen.getByText(
        "Click ▶ to expand; open/closed state is stored in localStorage",
      ),
    ).toBeTruthy();
    expect(document.querySelector(".tree-pane.collapsed.rail")).toBeTruthy();
    expect(document.querySelector(".brand-mark")).toBeTruthy();
    expect(document.querySelector(".rail-expand")).toBeTruthy();
    expect(document.querySelector(".rail-picked-badge")).toBeTruthy();
    expect(document.querySelector(".rail-time-btn")).toBeTruthy();
    expect(document.querySelector(".locale-cycle")).toBeTruthy();
    expect(document.querySelector(".rail-logout")).toBeTruthy();
  });

  it("keeps logout on the collapsed rail after login", async () => {
    localStorage.setItem("web-grep.treeOpen.v2", "0");
    mockFetch(
      () =>
        jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "missing or invalid session",
        }),
      undefined,
      { authRequired: true },
    );
    render(<App />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector('input[name="password"]') as Element, {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.querySelector(".tree-pane.collapsed.rail")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(document.querySelector(".rail-logout")).toBeTruthy();
  });
});

function treeRequestUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((call) => requestUrl(call[0] as RequestInfo))
    .filter((url) => url.includes("/api/tree"));
}

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
  const body = lastSearchRequest(fetchMock);
  return { query: body.query, regex: body.regex };
}

function lastSearchRequest(fetchMock: ReturnType<typeof vi.fn>): {
  query: string;
  regex: boolean;
  caseSensitive?: boolean;
  wordMatch?: boolean;
  andTerms?: string[];
  globInclude?: string[];
  globAnd?: string[];
  globExclude?: string[];
  mtimeAfter?: number;
} {
  const raw = searchCalls(fetchMock).at(-1)?.[1]?.body;
  if (typeof raw !== "string") {
    throw new Error("missing search body");
  }
  return JSON.parse(raw) as {
    query: string;
    regex: boolean;
    caseSensitive?: boolean;
    wordMatch?: boolean;
    andTerms?: string[];
    globInclude?: string[];
    globAnd?: string[];
    globExclude?: string[];
    mtimeAfter?: number;
  };
}
