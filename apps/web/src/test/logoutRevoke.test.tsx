/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_STORAGE_KEY } from "../api/headers.ts";
import { useAuth } from "../hooks/useAuth.ts";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("logout", () => {
  beforeEach(() => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "sess-abc");
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("sends the session token with the revoke request, then clears it", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        calls.push({
          url,
          headers: { ...(init?.headers as Record<string, string>) },
        });
        if (url.includes("/api/auth/status")) {
          return Promise.resolve(json(200, { authRequired: true }));
        }
        if (url.includes("/api/meta")) {
          return Promise.resolve(
            json(401, { code: "UNAUTHORIZED", message: "x" }),
          );
        }
        return Promise.resolve(json(200, { ok: true }));
      }),
    );
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout();
    });
    const revoke = calls.find((c) => c.url.includes("/api/auth/logout"));
    expect(revoke).toBeDefined();
    expect(revoke?.headers.Authorization).toBe("Bearer sess-abc");
    expect(revoke?.headers["X-Web-Grep-Token"]).toBe("sess-abc");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("still clears the local token when the revoke request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes("/api/auth/logout")) {
          return Promise.reject(new TypeError("network down"));
        }
        if (url.includes("/api/auth/status")) {
          return Promise.resolve(json(200, { authRequired: true }));
        }
        return Promise.resolve(
          json(401, { code: "UNAUTHORIZED", message: "x" }),
        );
      }),
    );
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout();
    });
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
