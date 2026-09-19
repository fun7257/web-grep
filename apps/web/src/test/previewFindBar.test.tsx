/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewFindBar } from "../components/PreviewFindBar.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";

function FindHarness({ text, line = "99" }: { text: string; line?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <LocaleProvider>
      <div className="preview-pane">
        <div className="preview" ref={rootRef} tabIndex={-1}>
          <header className="preview-header">
            <PreviewFindBar rootRef={rootRef} contentKey="preview-find-test" />
          </header>
          <div className="preview-hit">
            <div className="preview-line current">
              <span className="preview-n">{line}</span>
              <span className="preview-text">{text}</span>
            </div>
          </div>
        </div>
      </div>
    </LocaleProvider>
  );
}

function openFind(): void {
  fireEvent.click(screen.getByRole("button", { name: "Find in preview" }));
}

function queryBox(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Find in preview" });
}

function typeQuery(value: string): void {
  fireEvent.change(queryBox(), { target: { value } });
}

function countLabel(): string {
  return document.querySelector(".preview-find-count")?.textContent ?? "";
}

function pressFindKey(
  target: Element,
  key: string,
  opts: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): void {
  fireEvent.keyDown(target, {
    key,
    ctrlKey: opts.ctrl === true,
    altKey: opts.alt === true,
    shiftKey: opts.shift === true,
    bubbles: true,
  });
}

beforeEach(() => {
  localStorage.setItem("web-grep.locale", "en-US");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.getSelection()?.removeAllRanges();
});

describe("PreviewFindBar", () => {
  it("opens and closes from the toolbar button and the close control", () => {
    render(<FindHarness text="alpha foo beta" />);
    expect(screen.queryByRole("search")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Find in preview" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    openFind();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Find in preview" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(queryBox()).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("search")).toBeNull();

    openFind();
    fireEvent.click(screen.getByRole("button", { name: "Find in preview" }));
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("opens with Ctrl+F when the preview is focused and closes on Escape", () => {
    const { container } = render(<FindHarness text="alpha foo beta" />);
    const root = container.querySelector(".preview");
    expect(root).toBeTruthy();
    (root as HTMLElement).focus();
    pressFindKey(root as HTMLElement, "f", { ctrl: true });
    expect(screen.getByRole("search")).toBeTruthy();

    pressFindKey(queryBox(), "Escape");
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("does not steal Ctrl+F when focus is outside the preview pane", () => {
    render(<FindHarness text="alpha foo beta" />);
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    pressFindKey(outside, "f", { ctrl: true });
    expect(screen.queryByRole("search")).toBeNull();
    outside.remove();
  });

  it("hides the count for an empty query and shows no-match copy", () => {
    render(<FindHarness text="alpha foo beta" />);
    openFind();
    expect(document.querySelector(".preview-find-count")).toBeNull();

    typeQuery("zzz");
    expect(countLabel()).toBe("No matches");
    expect(window.getSelection()?.toString() ?? "").toBe("");

    typeQuery("");
    expect(document.querySelector(".preview-find-count")).toBeNull();
  });

  it("moves next and previous and wraps around", () => {
    render(<FindHarness text="alpha foo beta foo gamma foo" />);
    openFind();
    typeQuery("foo");
    expect(countLabel()).toBe("1/3");
    expect(window.getSelection()?.toString()).toBe("foo");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(countLabel()).toBe("2/3");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(countLabel()).toBe("3/3");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(countLabel()).toBe("1/3");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(countLabel()).toBe("3/3");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(countLabel()).toBe("2/3");
  });

  it("advances with Enter and wraps backward with Shift+Enter", () => {
    render(<FindHarness text="foo bar foo" />);
    openFind();
    typeQuery("foo");
    expect(countLabel()).toBe("1/2");
    pressFindKey(queryBox(), "Enter");
    expect(countLabel()).toBe("2/2");
    pressFindKey(queryBox(), "Enter");
    expect(countLabel()).toBe("1/2");
    pressFindKey(queryBox(), "Enter", { shift: true });
    expect(countLabel()).toBe("2/2");
  });

  it("does not move when there are no matches", () => {
    render(<FindHarness text="alpha foo beta" />);
    openFind();
    typeQuery("zzz");
    expect(countLabel()).toBe("No matches");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(countLabel()).toBe("No matches");
  });

  it("toggles case sensitivity from the Aa button and Alt+C", () => {
    render(<FindHarness text="Foo foo" />);
    openFind();
    typeQuery("foo");
    expect(countLabel()).toBe("1/2");

    const caseBtn = screen.getByRole("button", { name: "Aa" });
    expect(caseBtn.getAttribute("title")).toBe("Match Case (Alt+C)");
    expect(caseBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(caseBtn);
    expect(caseBtn.getAttribute("aria-pressed")).toBe("true");
    expect(countLabel()).toBe("1/1");

    pressFindKey(queryBox(), "c", { alt: true });
    expect(caseBtn.getAttribute("aria-pressed")).toBe("false");
    expect(countLabel()).toBe("1/2");
  });

  it("toggles whole-word matching from the word button and Alt+W", () => {
    render(<FindHarness text="cat catalog cat" />);
    openFind();
    typeQuery("cat");
    expect(countLabel()).toBe("1/3");

    const wordBtn = screen.getByRole("button", { name: "\\b" });
    expect(wordBtn.getAttribute("title")).toBe("Match Whole Word (Alt+W)");
    fireEvent.click(wordBtn);
    expect(wordBtn.getAttribute("aria-pressed")).toBe("true");
    expect(countLabel()).toBe("1/2");

    pressFindKey(queryBox(), "w", { alt: true });
    expect(wordBtn.getAttribute("aria-pressed")).toBe("false");
    expect(countLabel()).toBe("1/3");
  });

  it("does not search line numbers or the find bar chrome", () => {
    render(<FindHarness text="hello world" line="42" />);
    openFind();
    typeQuery("42");
    expect(countLabel()).toBe("No matches");

    typeQuery("Find");
    expect(countLabel()).toBe("No matches");
  });
});
