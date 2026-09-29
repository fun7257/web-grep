/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "../components/FileTree.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";
import type { TimeRange } from "../timeRange.ts";
import type { TreePick } from "../treePicks.ts";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** Root: dir `logs` + file `a.txt`; `logs` holds `x.log`. */
function stubTree() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(requestUrl(input), "http://x").searchParams.get("path") ?? "";
    const entries =
      path === ""
        ? [
            { name: "logs", path: "logs", dir: true },
            { name: "a.txt", path: "a.txt", dir: false },
          ]
        : [{ name: "x.log", path: "logs/x.log", dir: false }];
    return Promise.resolve(jsonResponse({ path, entries, truncated: false }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderTree(
  props: {
    timeRange?: TimeRange | null;
    onTogglePick?: () => void;
    picks?: TreePick[];
    onRemovePick?: (pick: TreePick) => void;
  } = {},
) {
  const onTogglePick = props.onTogglePick ?? (() => undefined);
  const ui = (timeRange: TimeRange | null) => (
    <LocaleProvider>
      <FileTree
        open
        onToggle={() => undefined}
        rootLabel="root"
        activePath={null}
        picks={props.picks ?? []}
        {...(props.onRemovePick !== undefined ? { onRemovePick: props.onRemovePick } : {})}
        onTogglePick={onTogglePick}
        onClear={() => undefined}
        sessionReady
        timeRange={timeRange}
      />
    </LocaleProvider>
  );
  const view = render(ui(props.timeRange ?? null));
  return { ...view, rerenderWith: (tr: TimeRange | null) => view.rerender(ui(tr)) };
}

function name(text: string): HTMLElement {
  return screen.getByText(text, { selector: ".tree-name" });
}

describe("file tree interaction", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("web-grep.locale", "en-US");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clicking a folder name expands it and does not pick it", async () => {
    stubTree();
    const onTogglePick = vi.fn();
    renderTree({ onTogglePick });
    await waitFor(() => expect(name("logs")).toBeTruthy());
    fireEvent.click(name("logs"));
    await waitFor(() => expect(name("x.log")).toBeTruthy());
    expect(onTogglePick).not.toHaveBeenCalled();
    fireEvent.click(name("logs"));
    expect(screen.queryByText("x.log")).toBeNull();
  });

  it("the checkbox picks without expanding", async () => {
    const fetchMock = stubTree();
    const onTogglePick = vi.fn();
    renderTree({ onTogglePick });
    await waitFor(() => expect(name("logs")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Select logs" }));
    expect(onTogglePick).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some((c) => requestUrl(c[0] as RequestInfo).includes("path=logs")),
    ).toBe(false);
  });

  it("keeps open folders open when a filter changes", async () => {
    stubTree();
    const { rerenderWith } = renderTree();
    await waitFor(() => expect(name("logs")).toBeTruthy());
    fireEvent.click(name("logs"));
    await waitFor(() => expect(name("x.log")).toBeTruthy());
    rerenderWith("7d");
    await waitFor(() => expect(name("x.log")).toBeTruthy());
  });

  it("arrow keys move focus, Right/Left fold, Space picks", async () => {
    stubTree();
    const onTogglePick = vi.fn();
    renderTree({ onTogglePick });
    await waitFor(() => expect(name("logs")).toBeTruthy());
    const logs = name("logs").closest("button") as HTMLElement;
    const file = name("a.txt").closest("button") as HTMLElement;
    logs.focus();
    fireEvent.keyDown(logs, { key: "ArrowRight" });
    await waitFor(() => expect(name("x.log")).toBeTruthy());
    fireEvent.keyDown(logs, { key: "ArrowLeft" });
    expect(screen.queryByText("x.log")).toBeNull();
    fireEvent.keyDown(logs, { key: "ArrowDown" });
    expect(document.activeElement).toBe(file);
    fireEvent.keyDown(file, { key: " " });
    expect(onTogglePick).toHaveBeenCalledTimes(1);
  });

  it("collapses the filter section and remembers it", async () => {
    stubTree();
    renderTree();
    await waitFor(() => expect(name("logs")).toBeTruthy());
    expect(screen.getByLabelText("Exclude")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scope" }));
    expect(screen.queryByLabelText("Exclude")).toBeNull();
    expect(localStorage.getItem("web-grep.treeFilters.v1")).toBe("0");
  });

  it("lists picks in a popover that does not move the tree", async () => {
    stubTree();
    const onRemovePick = vi.fn();
    const picks: TreePick[] = [{ path: "logs/x.log", dir: false }];
    renderTree({ picks, onRemovePick });
    await waitFor(() => expect(name("logs")).toBeTruthy());
    expect(document.querySelector(".pick-chip")).toBeNull();
    fireEvent.click(screen.getByText("1 selected"));
    expect(document.querySelector(".pick-chip-name")?.textContent).toBe("x.log");
    expect(document.querySelector(".pick-chip-path")?.textContent).toBe("logs/");
    fireEvent.click(document.querySelector(".pick-chip-x") as HTMLElement);
    expect(onRemovePick).toHaveBeenCalledWith(picks[0]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".pick-chip")).toBeNull();
  });

  it("the picked pill is inert when nothing is picked", async () => {
    stubTree();
    renderTree();
    await waitFor(() => expect(name("logs")).toBeTruthy());
    const pill = screen.getByText("0 selected") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
  });
});
