/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SseHit } from "@web-grep/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "../components/FilePreview.tsx";
import { FormattedLine } from "../components/FormattedPreview.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";

const XSS_MD = [
  "# Safe title",
  "",
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "[bad](javascript:alert(1))",
  '<a href="javascript:alert(2)">raw</a>',
  '<iframe src="javascript:alert(3)"></iframe>',
].join("\n");

function assertSanitized(root: ParentNode): void {
  expect(root.querySelector("script")).toBeNull();
  expect(root.querySelector("iframe")).toBeNull();
  expect(root.querySelector("[onerror]")).toBeNull();
  expect(root.querySelector("[onclick]")).toBeNull();
  const hrefs = [...root.querySelectorAll("a")].map((node) =>
    (node.getAttribute("href") ?? "").toLowerCase(),
  );
  expect(hrefs.some((href) => href.startsWith("javascript:"))).toBe(false);
}

function renderPreview(hit: SseHit, terms: string[] = []) {
  return render(
    <LocaleProvider>
      <FilePreview hit={hit} terms={terms} />
    </LocaleProvider>,
  );
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

describe("FormattedLine", () => {
  it("renders Markdown with headings, emphasis, and search-term marks", () => {
    const { container } = render(
      <FormattedLine
        path="docs/note.md"
        text={"# Hello World\n\nA paragraph with **bold**."}
        terms={["World"]}
      />,
    );
    const root = container.querySelector(".fmt-md");
    expect(root).toBeTruthy();
    expect(root?.querySelector("h1")?.textContent).toBe("Hello World");
    expect(root?.querySelector("strong")?.textContent).toBe("bold");
    expect(root?.querySelector("mark")?.textContent).toBe("World");
    expect(container.querySelector(".fmt-json")).toBeNull();
  });

  it("pretty-prints JSON with token classes and search-term marks", () => {
    const original = '{"hello":"World","n":1,"ok":true}';
    const { container } = render(
      <FormattedLine path="cfg.json" text={original} terms={["World"]} />,
    );
    const pre = container.querySelector(".fmt-json");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe(
      JSON.stringify(JSON.parse(original), null, 4),
    );
    expect(pre?.querySelector(".tok-key")?.textContent).toContain("hello");
    expect(pre?.querySelector(".tok-str")?.textContent).toContain("World");
    expect(pre?.querySelector(".tok-num")?.textContent).toBe("1");
    expect(pre?.querySelector(".tok-bool")?.textContent).toBe("true");
    expect(pre?.querySelector('[data-fmt="inj"]')).toBeTruthy();
    expect(pre?.querySelector("mark")?.textContent).toBe("World");
    expect(container.querySelector(".fmt-md")).toBeNull();
  });

  it("falls back to plain highlight when JSON cannot be pretty-printed", () => {
    const { container } = render(
      <FormattedLine path="broken.json" text="hello World" terms={["World"]} />,
    );
    expect(container.querySelector(".fmt-json")).toBeNull();
    expect(container.querySelector(".fmt-md")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("World");
    expect(container.textContent).toBe("hello World");
  });

  it("uses the highlight path for non-JSON, non-Markdown files", () => {
    const { container } = render(
      <FormattedLine
        path="src/a.ts"
        text="const World = 1"
        terms={["World"]}
      />,
    );
    expect(container.querySelector(".fmt-md")).toBeNull();
    expect(container.querySelector(".fmt-json")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("World");
  });

  it("treats a JSON-looking Markdown line as the JSON pretty path", () => {
    const { container } = render(
      <FormattedLine path="docs/note.md" text='{"hello":"World"}' terms={[]} />,
    );
    expect(container.querySelector(".fmt-json")).toBeTruthy();
    expect(container.querySelector(".fmt-md")).toBeNull();
  });

  it("strips script, event handlers, and javascript: URLs from Markdown", () => {
    const { container } = render(
      <FormattedLine path="docs/note.md" text={XSS_MD} terms={["Safe"]} />,
    );
    const root = container.querySelector(".fmt-md");
    expect(root).toBeTruthy();
    expect(root?.querySelector("h1")?.textContent).toBe("Safe title");
    expect(root?.querySelector("mark")?.textContent).toBe("Safe");
    assertSanitized(root as Element);
    expect((root as Element).innerHTML.toLowerCase()).not.toContain("<script");
    expect((root as Element).innerHTML.toLowerCase()).not.toContain("onerror");
  });
});

describe("FilePreview formatted path", () => {
  it("defaults Markdown hits to formatted view and can toggle source", () => {
    const hit: SseHit = {
      path: "docs/note.md",
      line: 3,
      text: "# Hello World\n\nbody",
      matches: [{ start: 8, end: 13 }],
    };
    const { container } = renderPreview(hit, ["World"]);
    expect(container.querySelector(".fmt-md")).toBeTruthy();
    expect(container.querySelector(".preview-hit")).toBeNull();
    expect(container.querySelector(".fmt-md mark")?.textContent).toBe("World");
    expect(
      screen
        .getByRole("button", { name: /^Preview$/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^Source$/ }));
    expect(container.querySelector(".fmt-md")).toBeNull();
    expect(container.querySelector(".preview-hit")).toBeTruthy();
    expect(container.querySelector(".preview-text")?.textContent).toContain(
      "Hello World",
    );

    fireEvent.click(screen.getByRole("button", { name: /^Preview$/ }));
    expect(container.querySelector(".fmt-md")).toBeTruthy();
    expect(container.querySelector(".preview-hit")).toBeNull();
  });

  it("defaults JSON hits to pretty formatted view", () => {
    const original = '{"hello":"World"}';
    const hit: SseHit = {
      path: "cfg.json",
      line: 1,
      text: original,
      matches: [{ start: 10, end: 15 }],
    };
    const { container } = renderPreview(hit, ["World"]);
    const pre = container.querySelector(".fmt-json");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe(
      JSON.stringify(JSON.parse(original), null, 4),
    );
    expect(pre?.querySelector("mark")?.textContent).toBe("World");
    expect(
      screen
        .getByRole("button", { name: /^Preview$/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps the find bar on formatted Markdown and still sanitizes XSS", () => {
    const hit: SseHit = {
      path: "docs/note.md",
      line: 1,
      text: XSS_MD,
      matches: [],
    };
    const { container } = renderPreview(hit, ["Safe"]);
    const root = container.querySelector(".fmt-md");
    expect(root).toBeTruthy();
    assertSanitized(root as Element);

    fireEvent.click(screen.getByRole("button", { name: "Find in preview" }));
    expect(screen.getByRole("search")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find in preview" }),
      {
        target: { value: "Safe" },
      },
    );
    expect(document.querySelector(".preview-find-count")?.textContent).toBe(
      "1/1",
    );
  });

  it("does not offer a format toggle for plain text hits", () => {
    const hit: SseHit = {
      path: "src/a.ts",
      line: 4,
      text: "const World = 1",
      matches: [{ start: 6, end: 11 }],
    };
    const { container } = renderPreview(hit, ["World"]);
    expect(screen.queryByRole("button", { name: /^Preview$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Source$/ })).toBeNull();
    expect(container.querySelector(".preview-hit")).toBeTruthy();
    expect(container.querySelector(".fmt-md")).toBeNull();
    expect(container.querySelector(".fmt-json")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Find in preview" }),
    ).toBeTruthy();
  });
});
