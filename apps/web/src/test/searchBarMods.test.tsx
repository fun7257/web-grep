/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBar } from "../components/SearchBar.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";
import { newPart, type QueryPart } from "../searchStack.ts";

function SearchBarHarness({
  onFlushSearch,
  initial = [newPart("hello")],
}: {
  onFlushSearch: (nextParts: QueryPart[]) => void;
  initial?: QueryPart[];
}) {
  const [fields, setFields] = useState<QueryPart[]>(initial);
  const queryRef = useRef<HTMLInputElement>(null);
  return (
    <LocaleProvider>
      <SearchBar
        fields={fields}
        onFieldsChange={setFields}
        onFlushSearch={onFlushSearch}
        canClear
        onClear={() => {}}
        queryRef={queryRef}
      />
    </LocaleProvider>
  );
}

function renderBar(initial?: QueryPart[]) {
  const onFlushSearch = vi.fn();
  render(
    initial === undefined ? (
      <SearchBarHarness onFlushSearch={onFlushSearch} />
    ) : (
      <SearchBarHarness onFlushSearch={onFlushSearch} initial={initial} />
    ),
  );
  return onFlushSearch;
}

beforeEach(() => {
  localStorage.setItem("web-grep.locale", "en-US");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("SearchBar option toggles", () => {
  it("updates Aa / word / regex without searching", () => {
    const onFlushSearch = renderBar();
    const caseBtn = screen.getByRole("button", { name: "Aa" });
    const wordBtn = screen.getByRole("button", { name: "\\b" });
    const regexBtn = screen.getByRole("button", { name: ".*" });

    fireEvent.click(caseBtn);
    fireEvent.click(wordBtn);
    fireEvent.click(regexBtn);

    expect(caseBtn.getAttribute("aria-pressed")).toBe("true");
    expect(wordBtn.getAttribute("aria-pressed")).toBe("true");
    expect(regexBtn.getAttribute("aria-pressed")).toBe("true");
    expect(onFlushSearch).not.toHaveBeenCalled();
  });

  it("updates mods from Alt+C / Alt+W / Alt+R without searching", () => {
    const onFlushSearch = renderBar();
    const box = screen.getByRole("searchbox");

    fireEvent.keyDown(box, { key: "c", altKey: true });
    fireEvent.keyDown(box, { key: "w", altKey: true });
    fireEvent.keyDown(box, { key: "r", altKey: true });

    expect(screen.getByRole("button", { name: "Aa" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "\\b" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: ".*" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(onFlushSearch).not.toHaveBeenCalled();
  });

  it("searches on Enter and the Search button", () => {
    const onFlushSearch = renderBar();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onFlushSearch).toHaveBeenCalledTimes(1);
    expect(onFlushSearch.mock.calls[0]?.[0]?.[0]?.value).toBe("hello");

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onFlushSearch).toHaveBeenCalledTimes(2);
  });

  it("searches from the AND panel Search button, not from extra-field mods", () => {
    const onFlushSearch = renderBar([newPart("hello"), newPart("world")]);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    const extra = screen.getByRole("textbox", { name: "Add filter" });
    const extraMods = extra
      .closest(".search-and-item")
      ?.querySelectorAll(".mod-btn");
    expect(extraMods?.length).toBe(3);
    fireEvent.click(extraMods?.[0] as HTMLButtonElement);
    expect(onFlushSearch).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".search-and-go") as HTMLButtonElement);
    expect(onFlushSearch).toHaveBeenCalledTimes(1);
    expect(
      onFlushSearch.mock.calls[0]?.[0]?.map((part: QueryPart) => part.value),
    ).toEqual(["hello", "world"]);
  });
});
