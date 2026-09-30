/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { SseHit } from "@web-grep/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShareLink } from "../hooks/useShareLink.ts";
import type { ShareState } from "../searchShare.ts";
import type { SearchStatus } from "../state/searchReducer.ts";

const flags = { caseSensitive: false, wordMatch: false, regex: false };

function hit(path: string, line: number): SseHit {
  return { path, line, text: "x", matches: [] };
}

function setup(props: {
  ready: boolean;
  shareState?: ShareState | null;
  hits?: SseHit[];
  status?: SearchStatus;
}) {
  const onRestore = vi.fn();
  const onSelectIndex = vi.fn();
  const hook = renderHook(
    (p: typeof props) =>
      useShareLink({
        ready: p.ready,
        onRestore,
        shareState: p.shareState ?? null,
        hits: p.hits ?? [],
        status: p.status ?? "idle",
        onSelectIndex,
      }),
    { initialProps: props },
  );
  return { ...hook, onRestore, onSelectIndex };
}

describe("useShareLink", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("waits until ready, then restores the link exactly once", () => {
    window.history.replaceState(null, "", "/?q=foo&q=bar&s=1");
    const { rerender, onRestore } = setup({ ready: false });
    expect(onRestore).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]?.[0].parts).toEqual(["foo", "bar"]);
    rerender({ ready: true });
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the URL carries no search", () => {
    const { onRestore } = setup({ ready: true });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("mirrors the share state into the query string once bootstrapped", () => {
    const state: ShareState = { parts: ["needle"], mods: [flags], ...flags };
    setup({ ready: true, shareState: state });
    expect(window.location.search).toBe("?q=needle");
  });

  it("selects the shared hit when it arrives in the stream", () => {
    window.history.replaceState(null, "", "/?q=foo&p=b.ts&n=7");
    const { rerender, onSelectIndex } = setup({ ready: true });
    rerender({
      ready: true,
      hits: [hit("a.ts", 1), hit("b.ts", 7)],
      status: "running",
    });
    expect(onSelectIndex).toHaveBeenCalledWith(1);
  });

  it("stops waiting once the search finishes without the shared hit", () => {
    window.history.replaceState(null, "", "/?q=foo&p=b.ts&n=7");
    const { rerender, onSelectIndex } = setup({ ready: true });
    rerender({ ready: true, hits: [hit("a.ts", 1)], status: "done" });
    rerender({
      ready: true,
      hits: [hit("a.ts", 1), hit("b.ts", 7)],
      status: "done",
    });
    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it("forgets the pending hit on dropPendingSelect", () => {
    window.history.replaceState(null, "", "/?q=foo&p=b.ts&n=7");
    const { result, rerender, onSelectIndex } = setup({ ready: true });
    act(() => {
      result.current.dropPendingSelect();
    });
    rerender({ ready: true, hits: [hit("b.ts", 7)], status: "running" });
    expect(onSelectIndex).not.toHaveBeenCalled();
  });
});
