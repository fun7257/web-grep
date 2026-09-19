/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_STORAGE_KEY } from "../api/headers.ts";
import {
  abortableSleep,
  fetchApi,
  fetchJson,
  isAbortError,
  readJsonError,
  SearchHttpError,
} from "../api/http.ts";
import { PUBLIC_PATH_META } from "../api/base.ts";

describe("shared JSON client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
    sessionStorage.clear();
    localStorage.clear();
  });

  it("detects abort errors from DOMException and Error", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      true,
    );
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });

  it("parses {code,message} and falls back for empty bodies", async () => {
    const parsed = await readJsonError(
      new Response(JSON.stringify({ code: "BUSY", message: "full" }), {
        status: 429,
      }),
    );
    expect(parsed).toBeInstanceOf(SearchHttpError);
    expect(parsed.status).toBe(429);
    expect(parsed.body).toEqual({ code: "BUSY", message: "full" });

    const unauthorized = await readJsonError(new Response("nope", { status: 401 }));
    expect(unauthorized.body).toEqual({
      code: "UNAUTHORIZED",
      message: "missing or invalid token",
    });

    const fallback = await readJsonError(new Response("nope", { status: 500 }));
    expect(fallback.body).toEqual({ code: "INTERNAL", message: "request failed" });
  });

  it("prefixes the public path and attaches the session token", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", PUBLIC_PATH_META);
    meta.setAttribute("content", "/web-grep/");
    document.head.append(meta);
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchApi("/api/meta");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("/web-grep/api/meta");
    expect(init.headers["X-Web-Grep-Token"]).toBe("tok-1");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("throws SearchHttpError from fetchJson on a JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "DENIED", message: "nope" }), {
          status: 403,
        }),
      ),
    );
    await expect(fetchJson("/api/tree")).rejects.toMatchObject({
      name: "SearchHttpError",
      status: 403,
      body: { code: "DENIED", message: "nope" },
    });
  });

  it("stops abortableSleep when the signal aborts", async () => {
    const ac = new AbortController();
    const pending = abortableSleep(10_000, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
