/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mappedMarkdownSelection,
  renderMarkdownWithOffsets,
} from "../formats/markdownPieces.ts";
import { MarkdownView } from "../formats/renderMarkdown.tsx";

describe("renderMarkdownWithOffsets", () => {
  it("annotates headings with source offsets from token.raw", () => {
    const html = renderMarkdownWithOffsets("# Title");
    expect(html).toContain('data-md-start="0"');
    expect(html).toContain("<h1");
  });

  it("annotates strong with the raw marker range", () => {
    const html = renderMarkdownWithOffsets("**joseKeyFail** in docs");
    expect(html).toContain("<strong");
    expect(html).toMatch(/data-md-start="0"/);
  });
});

describe("mappedMarkdownSelection", () => {
  it("returns original markdown including markers from data-md offsets", () => {
    const original = "**joseKeyFail** in docs";
    const { container } = render(
      <MarkdownView text={original} terms={["joseKeyFail"]} />,
    );
    const root = container.querySelector(".fmt-md");
    expect(root).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(root as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const mapped = mappedMarkdownSelection(root as HTMLElement, original);
    expect(mapped).toContain("**joseKeyFail**");
    expect(original.includes(mapped)).toBe(true);
    expect(root?.querySelector("mark")?.textContent).toBe("joseKeyFail");
    expect(
      root?.querySelector("[data-md-start]")?.getAttribute("data-md-start"),
    ).toBe("0");
  });

  it("maps an inner mark selection to a tight substring", () => {
    const original = "Here is **joseKeyFail** inside bold";
    const { container } = render(
      <MarkdownView text={original} terms={["joseKeyFail"]} />,
    );
    const root = container.querySelector(".fmt-md");
    const mark = root?.querySelector("mark");
    expect(root).toBeTruthy();
    expect(mark?.textContent).toBe("joseKeyFail");
    const range = document.createRange();
    range.selectNodeContents(mark as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const mapped = mappedMarkdownSelection(root as HTMLElement, original);
    expect(mapped).toBe("joseKeyFail");
    expect(mapped).not.toBe(original);
    expect(original.includes(mapped)).toBe(true);
    expect(mapped).not.toMatch(/Here is/);
    expect(mapped).not.toMatch(/inside bold/);
  });
});
