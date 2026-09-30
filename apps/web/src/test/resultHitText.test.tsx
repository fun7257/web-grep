/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultHitText } from "../components/ResultRow.tsx";

describe("ResultHitText", () => {
  it("shows the match on a long line, not the prefix", () => {
    const text = `${"padding-".repeat(40)}FINDME${"-tail".repeat(20)}`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["FINDME"]}
        opts={{ caseSensitive: true, wordMatch: false, regex: false }}
      />,
    );
    const row = container.querySelector(".result-text");
    expect(row?.textContent).toContain("FINDME");
    expect(row?.textContent).toContain("...");
    expect(row?.querySelector("mark")?.textContent).toBe("FINDME");
    expect(row?.textContent?.startsWith("padding-")).toBe(false);
    const shown = row?.textContent ?? "";
    expect(shown.indexOf("FINDME")).toBeLessThanOrEqual(160);
  });

  it("still shows the highlight when the match sits late in a URL", () => {
    const text = `https://ehall.example/login?hash=${"A".repeat(400)}&host=test.gf.com.cn&ok=1`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["test.gf.com.cn"]}
        opts={{ caseSensitive: false, wordMatch: false, regex: false }}
      />,
    );
    const mark = container.querySelector(".result-text mark");
    expect(mark?.textContent).toBe("test.gf.com.cn");
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown.indexOf("test.gf.com.cn")).toBeLessThanOrEqual(160);
  });

  it("shows every far-apart AND term in the row", () => {
    const text = `alpha${"x".repeat(800)}omega`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["alpha", "omega"]}
        opts={{ caseSensitive: true, wordMatch: false, regex: false }}
      />,
    );
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown).toContain("alpha");
    expect(shown).toContain("omega");
    expect(container.querySelector(".result-snip-skip")?.textContent).toContain(
      "...",
    );
    const marks = [...container.querySelectorAll(".result-text mark")].map(
      (node) => node.textContent,
    );
    expect(marks).toContain("alpha");
    expect(marks).toContain("omega");
  });

  it("marks only the tail when the match is near the start", () => {
    const text = `FINDME${"x".repeat(2000)}`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["FINDME"]}
        opts={{ caseSensitive: true, wordMatch: false, regex: false }}
      />,
    );
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown.startsWith("FINDME")).toBe(true);
    expect(shown.includes("...")).toBe(false);
    expect(
      container.querySelector(".result-snip-skip.is-end")?.textContent,
    ).toContain("...");
    expect(container.querySelector("mark")?.textContent).toBe("FINDME");
  });

  it("marks only the head when the match is at the end", () => {
    const text = `${"x".repeat(2000)}FINDME`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["FINDME"]}
        opts={{ caseSensitive: true, wordMatch: false, regex: false }}
      />,
    );
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown.startsWith("...")).toBe(true);
    expect(shown.endsWith("FINDME")).toBe(true);
    expect(container.querySelector(".result-snip-skip.is-end")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("FINDME");
  });

  it("marks both sides when the match is in the middle", () => {
    const text = `${"a".repeat(800)}FINDME${"b".repeat(800)}`;
    const { container } = render(
      <ResultHitText
        text={text}
        terms={["FINDME"]}
        opts={{ caseSensitive: true, wordMatch: false, regex: false }}
      />,
    );
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown.startsWith("...")).toBe(true);
    expect(shown).toContain("FINDME");
    expect(
      container.querySelector(".result-snip-skip.is-end")?.textContent,
    ).toContain("...");
    expect(container.querySelector("mark")?.textContent).toBe("FINDME");
  });

  it("highlights 目标词 at the UTF-16 offsets from cjk.txt", () => {
    const text = "前缀😀目标词后缀";
    expect(text.slice(4, 7)).toBe("目标词");
    const { container } = render(
      <ResultHitText text={text} matches={[{ start: 4, end: 7 }]} />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("目标词");
    expect(container.querySelector(".result-text")?.textContent).toBe(text);
    expect(container.querySelector(".result-snip-skip")).toBeNull();
  });

  it("does not split a surrogate pair at the window edge", () => {
    const text = `😀${"x".repeat(149)}needle${"y".repeat(400)}`;
    const at = text.indexOf("needle");
    const { container } = render(
      <ResultHitText text={text} matches={[{ start: at, end: at + 6 }]} />,
    );
    const shown = container.querySelector(".result-text")?.textContent ?? "";
    expect(shown).toContain("needle");
    expect(shown).toContain("😀");
    expect(container.querySelector("mark")?.textContent).toBe("needle");
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
