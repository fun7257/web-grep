/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileWindowResponse } from "@web-grep/shared";
import { fetchFileWindow } from "../api/fileClient.ts";
import { useFileWindow } from "../hooks/useFileWindow.ts";
import { createT } from "../i18n/index.ts";

vi.mock("../api/fileClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/fileClient.ts")>();
  return {
    ...actual,
    fetchFileWindow: vi.fn(),
  };
});

const fetchMock = vi.mocked(fetchFileWindow);

function windowOf(
  path: string,
  from: number,
  last: number,
): FileWindowResponse {
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

describe("file window stale slices", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("discards a late slice after the path changes", async () => {
    let resolveA!: (value: FileWindowResponse) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<FileWindowResponse>((resolve) => {
          resolveA = resolve;
        }),
    );
    const { result } = renderHook(() => useFileWindow(createT("en-US")));
    result.current.pathRef.current = "a.txt";
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.loadSlice(
        { path: "a.txt", from: 1 },
        { mode: "replace" },
      );
    });
    result.current.pathRef.current = "b.txt";
    await act(async () => {
      resolveA(windowOf("a.txt", 1, 3));
      await pending;
    });
    expect(result.current.lines).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("discards a late merge after a later replace on the same file", async () => {
    fetchMock.mockResolvedValueOnce(windowOf("ok.txt", 1, 4));
    const { result } = renderHook(() => useFileWindow(createT("en-US")));
    result.current.pathRef.current = "ok.txt";
    await act(async () => {
      await result.current.loadSlice(
        { path: "ok.txt", from: 1 },
        { mode: "replace" },
      );
    });
    expect(result.current.lines.map((line) => line.n)).toEqual([1, 2, 3, 4]);

    let resolveMerge!: (value: FileWindowResponse) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<FileWindowResponse>((resolve) => {
          resolveMerge = resolve;
        }),
    );
    let mergePending: Promise<unknown> | undefined;
    act(() => {
      mergePending = result.current.loadSlice(
        { path: "ok.txt", from: 5 },
        { mode: "merge", dir: "down" },
      );
    });

    fetchMock.mockResolvedValueOnce(windowOf("ok.txt", 50, 52));
    await act(async () => {
      await result.current.loadSlice(
        { path: "ok.txt", from: 50 },
        { mode: "replace" },
      );
    });
    expect(result.current.lines.map((line) => line.n)).toEqual([50, 51, 52]);

    await act(async () => {
      resolveMerge(windowOf("ok.txt", 5, 8));
      await mergePending;
    });
    await waitFor(() => {
      expect(result.current.lines.map((line) => line.n)).toEqual([50, 51, 52]);
    });
    expect(result.current.lines.some((line) => line.n === 5)).toBe(false);
  });
});
