/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchHttpError } from "../api/http.ts";
import { fetchRootTreeRetry } from "../api/treeClient.ts";
import { FileTree } from "../components/FileTree.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";
import type { TimeRange } from "../timeRange.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function listing(names: string[]) {
  return {
    path: "",
    truncated: false,
    entries: names.map((name) => ({ name, path: name, dir: false })),
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

function renderTree(timeRange: TimeRange | null = null) {
  return render(
    <LocaleProvider>
      <FileTree
        open
        onToggle={() => undefined}
        rootLabel="root"
        activePath={null}
        picks={[]}
        onTogglePick={() => undefined}
        onClear={() => undefined}
        sessionReady
        timeRange={timeRange}
      />
    </LocaleProvider>,
  );
}

describe("root tree cancel", () => {
  beforeEach(() => {
    localStorage.setItem("web-grep.locale", "en-US");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("returns aborted and does not retry after the signal is cancelled", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
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
    });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    const pending = fetchRootTreeRetry(ac.signal, undefined, [], undefined, {
      sleep: async () => {
        throw new Error("should not sleep after abort");
      },
    });
    ac.abort();
    await expect(pending).resolves.toEqual({ ok: false, kind: "aborted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not sleep again once cancelled between retries", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(() => {
      attempts += 1;
      return Promise.reject(
        new SearchHttpError(500, { code: "INTERNAL", message: "boom" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();
    const pending = fetchRootTreeRetry(ac.signal, undefined, [], undefined, {
      sleep: async (_ms, signal) => {
        if (attempts === 1) {
          ac.abort();
        }
        if (signal.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
      },
    });
    await expect(pending).resolves.toEqual({ ok: false, kind: "aborted" });
    expect(attempts).toBe(1);
  });

  it("discards a late root listing after the filter changes", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!requestUrl(input).includes("/api/tree")) {
        return Promise.resolve(jsonResponse(404, { code: "INTERNAL", message: "x" }));
      }
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const abort = (): void => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (signal?.aborted === true) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        resolvers.push(resolve);
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderTree(null);
    await waitFor(() => {
      expect(resolvers.length).toBe(1);
    });

    rerender(
      <LocaleProvider>
        <FileTree
          open
          onToggle={() => undefined}
          rootLabel="root"
          activePath={null}
          picks={[]}
          onTogglePick={() => undefined}
          onClear={() => undefined}
          sessionReady
          timeRange="today"
        />
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(resolvers.length).toBe(2);
    });

    resolvers[0]?.(jsonResponse(200, listing(["stale.txt"])));
    resolvers[1]?.(jsonResponse(200, listing(["fresh.txt"])));

    await waitFor(() => {
      expect(document.body.textContent).toContain("fresh.txt");
    });
    expect(document.body.textContent).not.toContain("stale.txt");
  });
});
