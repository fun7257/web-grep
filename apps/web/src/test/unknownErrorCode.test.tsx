/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "../hooks/useSearch.ts";

function sseResponse(frame: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("unknown error codes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not throw when an SSE error code is outside the contract, and ends as INTERNAL", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(
            'event: error\ndata: {"code":"NO_SUCH_CODE","message":"boom"}\n\n',
          ),
        ),
    );
    const { result } = renderHook(() => useSearch());
    act(() => {
      result.current.submit({ query: "alpha" });
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toEqual({
      code: "INTERNAL",
      message: "search failed",
    });
  });

  it("keeps a NOT_FOUND SSE error instead of treating it as malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(
            'event: error\ndata: {"code":"NOT_FOUND","message":"not found"}\n\n',
          ),
        ),
    );
    const { result } = renderHook(() => useSearch());
    act(() => {
      result.current.submit({ query: "alpha" });
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toEqual({
      code: "NOT_FOUND",
      message: "not found",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
