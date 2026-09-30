/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LogLineText } from "../components/ResultRow.tsx";
import { LOG_LINE_CHAR_BUDGET } from "../resultSnippet.ts";

const opts = { caseSensitive: true, wordMatch: false, regex: false };

function shownText(container: HTMLElement): string {
  return container.querySelector(".result-text")?.textContent ?? "";
}

function marks(container: HTMLElement): string[] {
  return [...container.querySelectorAll("mark")].map(
    (node) => node.textContent ?? "",
  );
}

describe("LogLineText", () => {
  it("leaves a short line unchanged", () => {
    const text = "hello needle world";
    const { container } = render(
      <LogLineText text={text} terms={["needle"]} opts={opts} />,
    );
    expect(shownText(container)).toBe(text);
    expect(marks(container)).toEqual(["needle"]);
    expect(container.querySelector(".result-snip-skip")).toBeNull();
  });

  it("shows a leading hit with only a trailing ellipsis", () => {
    const text = `needle${"x".repeat(4000)}`;
    const { container } = render(
      <LogLineText
        text={text}
        matches={[{ start: 0, end: 6 }]}
        terms={["needle"]}
        opts={opts}
      />,
    );
    const shown = shownText(container);
    expect(shown.startsWith("needle")).toBe(true);
    expect(shown.startsWith("…")).toBe(false);
    expect(shown.endsWith("…")).toBe(true);
    expect(marks(container)).toContain("needle");
    expect(container.querySelector(".result-snip-skip")).toBeNull();
  });

  it("shows a middle hit with ellipses on both sides", () => {
    const text = `${"a".repeat(5000)}needle${"b".repeat(5000)}`;
    const at = 5000;
    const { container } = render(
      <LogLineText
        text={text}
        matches={[{ start: at, end: at + 6 }]}
        terms={["needle"]}
        opts={opts}
      />,
    );
    const shown = shownText(container);
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown).toContain("needle");
    expect(marks(container)).toEqual(["needle"]);
    expect(shown.indexOf("needle")).toBeGreaterThan(0);
    expect(shown.indexOf("needle")).toBeLessThan(shown.length - 1);
  });

  it("shows a trailing hit with only a leading ellipsis", () => {
    const text = `${"x".repeat(20000)}needle`;
    const at = 20000;
    const { container } = render(
      <LogLineText
        text={text}
        matches={[{ start: at, end: at + 6 }]}
        terms={["needle"]}
        opts={opts}
      />,
    );
    const shown = shownText(container);
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.endsWith("needle")).toBe(true);
    expect(shown.endsWith("…")).toBe(false);
    expect(shown).toContain("needle");
    expect(marks(container)).toEqual(["needle"]);
    expect(shown.length).toBeLessThan(LOG_LINE_CHAR_BUDGET);
  });

  it("keeps every far-apart hit, including the first", () => {
    const text = `alpha${"x".repeat(5000)}omega`;
    const omega = text.indexOf("omega");
    const { container } = render(
      <LogLineText
        text={text}
        matches={[
          { start: 0, end: 5 },
          { start: omega, end: omega + 5 },
        ]}
        terms={["alpha", "omega"]}
        opts={opts}
      />,
    );
    const shown = shownText(container);
    expect(shown.startsWith("alpha")).toBe(true);
    expect(shown.endsWith("omega")).toBe(true);
    expect(shown).toContain("…");
    expect(marks(container)).toEqual(
      expect.arrayContaining(["alpha", "omega"]),
    );
  });

  it("falls back to the prefix and a trailing ellipsis when nothing matches", () => {
    const text = `head${"x".repeat(4000)}`;
    const { container } = render(<LogLineText text={text} />);
    const shown = shownText(container);
    expect(shown.startsWith("head")).toBe(true);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.startsWith("…")).toBe(false);
    expect(shown.includes("needle")).toBe(false);
    expect(shown.length).toBe(LOG_LINE_CHAR_BUDGET + 1);
    expect(marks(container)).toEqual([]);
  });

  it("highlights 目标词 from cjk.txt UTF-16 offsets on a short line", () => {
    const text = "前缀😀目标词后缀";
    expect(text.slice(4, 7)).toBe("目标词");
    const { container } = render(
      <LogLineText text={text} matches={[{ start: 4, end: 7 }]} />,
    );
    expect(marks(container)).toEqual(["目标词"]);
    expect(shownText(container)).toBe(text);
    expect(loneSurrogate(shownText(container))).toBe(false);
  });

  it("keeps a late 目标词 visible without splitting the emoji", () => {
    const cjk = "前缀😀目标词后缀";
    const text = `${"x".repeat(4000)}${cjk}`;
    const at = 4000 + 4;
    const { container } = render(
      <LogLineText text={text} matches={[{ start: at, end: at + 3 }]} />,
    );
    const shown = shownText(container);
    expect(marks(container)).toEqual(["目标词"]);
    expect(shown).toContain("😀");
    expect(shown.startsWith("…")).toBe(true);
    expect(loneSurrogate(shown)).toBe(false);
  });

  it("does not split a surrogate at the window edge", () => {
    const text = `😀${"x".repeat(149)}needle${"y".repeat(4000)}`;
    const at = text.indexOf("needle");
    const { container } = render(
      <LogLineText text={text} matches={[{ start: at, end: at + 6 }]} />,
    );
    const shown = shownText(container);
    expect(marks(container)).toEqual(["needle"]);
    expect(shown).toContain("😀");
    expect(loneSurrogate(shown)).toBe(false);
  });
});

function loneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
