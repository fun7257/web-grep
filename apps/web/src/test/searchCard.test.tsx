/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "../components/SearchBar.tsx";
import { HL_TONES } from "../highlight.ts";
import { LocaleProvider } from "../hooks/useLocale.ts";
import {
  clearSearchHistory,
  loadSearchHistory,
  SEARCH_HISTORY_KEY,
  type SearchHistoryItem,
} from "../searchHistory.ts";
import { newPart, type QueryPart } from "../searchStack.ts";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
  "utf8",
);

function Harness({
  onFlushSearch,
  initial = [newPart("hello")],
  searchLocked = false,
  running = false,
  history = [] as SearchHistoryItem[],
  onClearHistory,
  onRestoreHistory,
  canClear = true,
}: {
  onFlushSearch: (nextParts: QueryPart[]) => void;
  initial?: QueryPart[];
  searchLocked?: boolean;
  running?: boolean;
  history?: SearchHistoryItem[];
  onClearHistory?: () => void;
  onRestoreHistory?: (item: SearchHistoryItem) => void;
  canClear?: boolean;
}) {
  const [fields, setFields] = useState<QueryPart[]>(initial);
  const queryRef = useRef<HTMLInputElement>(null);
  return (
    <LocaleProvider>
      <SearchBar
        fields={fields}
        onFieldsChange={setFields}
        onFlushSearch={onFlushSearch}
        canClear={canClear}
        onClear={() => {
          setFields([newPart("")]);
        }}
        queryRef={queryRef}
        searchLocked={searchLocked}
        running={running}
        history={history}
        {...(onClearHistory !== undefined ? { onClearHistory } : {})}
        {...(onRestoreHistory !== undefined ? { onRestoreHistory } : {})}
      />
    </LocaleProvider>
  );
}

function renderCard(
  props: Omit<Parameters<typeof Harness>[0], "onFlushSearch"> = {},
) {
  const onFlushSearch = vi.fn();
  render(<Harness onFlushSearch={onFlushSearch} {...props} />);
  return onFlushSearch;
}

function fillAndAdd(value: string, name: string): void {
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
}

let scrolls = 0;

beforeEach(() => {
  localStorage.setItem("web-grep.locale", "en-US");
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  scrolls = 0;
  Element.prototype.scrollIntoView = () => {
    scrolls += 1;
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("inline filter rows", () => {
  it("adds and removes a row, then focuses the new input", () => {
    renderCard();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    const first = screen.getByRole("textbox", { name: "Filter 1" });
    expect(document.activeElement).toBe(first);
    expect(scrolls).toBeGreaterThan(0);
    expect(document.querySelector(".search-filter-count")?.textContent).toBe(
      "1 / 15",
    );
    fireEvent.change(first, { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    const second = screen.getByRole("textbox", { name: "Filter 2" });
    expect(document.activeElement).toBe(second);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter 1" }));
    expect(screen.queryByRole("textbox", { name: "Filter 2" })).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Filter 1" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: "Remove filter 1" }),
    ).toBeTruthy();
  });

  it("paints filter dots with the same tone as highlight.ts", () => {
    for (let tone = 0; tone < HL_TONES; tone++) {
      expect(css).toContain(`.hl-dot[data-tone="${tone}"]`);
      const start = css.indexOf(`.hl-dot[data-tone="${tone}"]`);
      const body = css.slice(start, css.indexOf("}", start));
      expect(body).toContain(`var(--hl-${tone})`);
    }
    renderCard();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    for (let i = 1; i <= HL_TONES; i++) {
      fillAndAdd(`t${i}`, `Filter ${i}`);
    }
    const dots = document.querySelectorAll(".search-filter-row .hl-dot");
    expect(dots).toHaveLength(HL_TONES + 1);
    dots.forEach((dot, index) => {
      const tone = (index + 1) % HL_TONES;
      expect(dot.getAttribute("data-tone")).toBe(String(tone));
      expect((dot as HTMLElement).style.backgroundColor).toBe(
        `var(--hl-${tone})`,
      );
    });
  });

  it("shows n / 15 only while rows exist and disables add at 15", () => {
    renderCard({ initial: [newPart("q")] });
    expect(document.querySelector(".search-filter-count")).toBeNull();
    for (let i = 1; i <= 15; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
      fireEvent.change(screen.getByRole("textbox", { name: `Filter ${i}` }), {
        target: { value: `t${i}` },
      });
    }
    expect(document.querySelector(".search-filter-count")?.textContent).toBe(
      "15 / 15",
    );
    expect(
      (screen.getByRole("button", { name: "Add filter" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(screen.queryByRole("textbox", { name: "Filter 16" })).toBeNull();
  });

  it("adds a row on Shift+Enter and ignores IME composition", () => {
    renderCard();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "hello" },
    });
    fireEvent.keyDown(window, {
      key: "Enter",
      shiftKey: true,
      isComposing: true,
    });
    expect(screen.queryByRole("textbox", { name: "Filter 1" })).toBeNull();
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("textbox", { name: "Filter 1" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Filter 1" }),
    );
  });

  it("toggles regex on the focused filter row with Alt+R", () => {
    renderCard({ initial: [newPart("hello"), newPart("world")] });
    const filter = screen.getByRole("textbox", { name: "Filter 1" });
    fireEvent.keyDown(filter, { key: "r", altKey: true });
    const pressed = screen.getAllByRole("button", { name: ".*" });
    expect(pressed[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(pressed[1]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("drops empty filter rows when the search is submitted", () => {
    const onFlushSearch = renderCard({
      initial: [newPart("hello"), newPart("   "), newPart("world")],
    });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    const parts = onFlushSearch.mock.calls[0]?.[0] as QueryPart[];
    expect(parts.map((part) => part.value)).toEqual(["hello", "world"]);
  });

  it("locks the card, disables the query and search, and hides add-filter", () => {
    renderCard({ searchLocked: true, canClear: true });
    const card = document.querySelector(".search-card");
    expect(card?.classList.contains("is-locked")).toBe(true);
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Search" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Add filter" })).toBeNull();
    expect(screen.getByText("Search is locked")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(document.querySelector(".search-filter-count")).toBeNull();
  });

  it("keeps Cancel enabled while a locked card is still running", () => {
    renderCard({ searchLocked: true, running: true });
    const cancel = screen.getByRole("button", {
      name: "Cancel",
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    expect(cancel.classList.contains("cancel")).toBe(true);
  });
});

describe("recent searches", () => {
  const item: SearchHistoryItem = {
    id: "h1",
    timeRange: "today",
    parts: [
      { value: "needle", caseSensitive: true, wordMatch: false, regex: false },
      { value: "alpha", caseSensitive: false, wordMatch: true, regex: true },
      { value: "beta", caseSensitive: false, wordMatch: false, regex: false },
    ],
  };

  it("shows query and filter dots, enabled switches, the filter count, and the time range", () => {
    const onRestore = vi.fn();
    renderCard({ history: [item], onRestoreHistory: onRestore });
    fireEvent.click(screen.getByRole("button", { name: "Recent searches" }));
    const dialog = screen.getByRole("dialog", { name: "Recent searches" });
    const row = screen.getByRole("button", { name: /needle/ });
    const dots = row.querySelectorAll(".hl-dot");
    expect([...dots].map((dot) => dot.getAttribute("data-tone"))).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(
      [...dots].map((dot) => (dot as HTMLElement).style.backgroundColor),
    ).toEqual(["var(--hl-0)", "var(--hl-1)", "var(--hl-2)"]);
    expect(row.querySelectorAll(".search-history-plus")).toHaveLength(2);
    expect(
      [...dialog.querySelectorAll(".search-history-tag")].map(
        (tag) => tag.textContent,
      ),
    ).toEqual(["Aa", "Whole word", ".*", "2 filters", "Today"]);
    fireEvent.click(row);
    expect(onRestore).toHaveBeenCalledWith(item);
    expect(
      screen.queryByRole("dialog", { name: "Recent searches" }),
    ).toBeNull();
  });

  it("clears storage and stays empty after the card is mounted again", () => {
    const onClearHistory = vi.fn(() => {
      clearSearchHistory();
    });
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify([item]));
    const view = render(
      <Harness
        onFlushSearch={vi.fn()}
        history={[item]}
        onClearHistory={onClearHistory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recent searches" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearHistory).toHaveBeenCalledTimes(1);
    expect(loadSearchHistory()).toEqual([]);
    expect(screen.getByText("No recent searches")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /needle/ })).toBeNull();
    view.unmount();
    renderCard({ history: loadSearchHistory() });
    fireEvent.click(screen.getByRole("button", { name: "Recent searches" }));
    expect(screen.getByText("No recent searches")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /needle/ })).toBeNull();
  });
});
