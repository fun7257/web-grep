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
});
