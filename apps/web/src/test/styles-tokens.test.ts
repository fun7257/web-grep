import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../styles.css");
const css = readFileSync(cssPath, "utf8");

function ruleBody(selector: string): string {
  const needle = `\n${selector} {`;
  const idx = css.indexOf(needle);
  if (idx === -1) {
    throw new Error(`missing CSS rule ${selector} in ${cssPath}`);
  }
  const start = css.indexOf("{", idx);
  const end = css.indexOf("}", start);
  return css.slice(start + 1, end);
}

describe("shipped stylesheet tokens", () => {
  it("defines light and dark theme blocks", () => {
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain('html[data-theme="light"]');
  });

  it("gives results and preview different background tokens", () => {
    expect(ruleBody(".hits-pane")).toContain("background: var(--bg)");
    const previewIdx = css.lastIndexOf("\n.preview-pane {");
    expect(previewIdx).toBeGreaterThan(-1);
    const previewBody = css.slice(
      css.indexOf("{", previewIdx) + 1,
      css.indexOf("}", previewIdx),
    );
    expect(previewBody).toContain("background: var(--bg-preview)");
    const dark = css.slice(
      css.indexOf('html[data-theme="dark"]'),
      css.indexOf('html[data-theme="light"]'),
    );
    const light = css.slice(css.indexOf('html[data-theme="light"]'));
    expect(dark).toContain("--bg-preview:");
    expect(light).toContain("--bg-preview:");
    const darkBg = dark.match(/--bg:\s*([^;]+)/)?.[1]?.trim();
    const darkPreview = dark.match(/--bg-preview:\s*([^;]+)/)?.[1]?.trim();
    const lightBg = light.match(/--bg:\s*([^;]+)/)?.[1]?.trim();
    const lightPreview = light.match(/--bg-preview:\s*([^;]+)/)?.[1]?.trim();
    expect(darkPreview).not.toBe(darkBg);
    expect(lightPreview).not.toBe(lightBg);
  });

  it("uses a theme token for Search hover so light ink stays readable", () => {
    const body = ruleBody(".search-bar .search-go:hover");
    expect(body).toContain("var(--accent-hover)");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("keeps a distinct --accent-hover in both theme palettes", () => {
    const dark = css.slice(
      css.indexOf('html[data-theme="dark"]'),
      css.indexOf('html[data-theme="light"]'),
    );
    const light = css.slice(css.indexOf('html[data-theme="light"]'));
    expect(dark).toContain("--accent-hover:");
    expect(light).toContain("--accent-hover:");
    expect(dark).toContain("--accent-ink:");
    expect(light).toContain("--accent-ink:");
  });

  it("gives light theme its own preview syntax inks", () => {
    const light = css.slice(css.indexOf('html[data-theme="light"]'));
    expect(light).toContain("--tok-key:");
    expect(light).toContain("--tok-str:");
    expect(light).toContain("--tok-num:");
    expect(light).toContain("--tok-bool:");
    const dark = css.slice(
      css.indexOf('html[data-theme="dark"]'),
      css.indexOf('html[data-theme="light"]'),
    );
    const lightKey = light.match(/--tok-key:\s*([^;]+)/)?.[1]?.trim();
    const darkKey = dark.match(/--tok-key:\s*([^;]+)/)?.[1]?.trim();
    expect(lightKey).not.toBe(darkKey);
  });

  it("uses theme tokens for grouped result sticky and collapse chrome", () => {
    const selectors = [
      ".result-sticky-header",
      ".result-sticky-header.is-pushing",
      ".result-group-header.is-entering",
    ];
    for (const selector of selectors) {
      const body = ruleBody(selector);
      expect(body, selector).toMatch(/var\(--/);
      expect(body, selector).not.toMatch(/rgb\(\s*0\s+0\s+0\s*\//);
      expect(body, selector).not.toMatch(/rgb\(\s*126\s+168\s+255\s*\//);
    }
    const kfStart = css.indexOf("@keyframes file-swap-bar");
    expect(kfStart).toBeGreaterThan(-1);
    const kf = css.slice(kfStart, css.indexOf("@keyframes file-swap-name"));
    expect(kf).toContain("var(--selected)");
    expect(kf).toContain("var(--sticky-shadow)");
    expect(kf).toContain("var(--swap-ring)");
    expect(kf).not.toMatch(/rgb\(\s*0\s+0\s+0\s*\//);
    expect(kf).not.toMatch(/rgb\(\s*126\s+168\s+255\s*\//);
  });

  it("uses tone tokens instead of white overlays on chrome that shows in light theme", () => {
    const selectors = [
      ".q-x:hover",
      ".tree-twist:hover",
      '.view-toggle button[aria-pressed="true"]',
      ".fmt-md code",
      ".result-row.grouped",
    ];
    for (const selector of selectors) {
      const body = ruleBody(selector);
      expect(body, selector).not.toMatch(/rgb\(\s*255\s+255\s+255/);
      expect(body, selector).toMatch(/var\(--(hover|selected|line)\)/);
    }
  });

  it("login dialog uses app theme tokens instead of white chrome", () => {
    const card = ruleBody(".token-prompt");
    expect(card).toContain("var(--elev)");
    expect(card).toContain("var(--line-strong)");
    expect(card).not.toMatch(/rgb\(\s*255\s+255\s+255/);
    const submit = ruleBody('.token-prompt button[type="submit"]');
    expect(submit).toContain("var(--accent)");
    expect(submit).toContain("var(--accent-ink)");
    const hover = ruleBody('.token-prompt button[type="submit"]:hover');
    expect(hover).toContain("var(--accent-hover)");
    expect(hover).not.toMatch(/rgb\(\s*255\s+255\s+255/);
    const overlay = ruleBody(".token-overlay");
    expect(overlay).not.toMatch(/rgb\(\s*255\s+255\s+255/);
    expect(css).toContain('html[data-theme="light"] .token-overlay');
  });

  it("overlay chrome uses shared motion tokens", () => {
    const selectors = [
      ".search-dropdown",
      ".preview-find-pop",
      ".sel-menu",
      ".toast-overlay",
    ];
    for (const selector of selectors) {
      const body = ruleBody(selector);
      expect(body, selector).toContain("var(--duration)");
      expect(body, selector).toContain("var(--ease)");
    }
    expect(ruleBody(".result-row")).not.toMatch(/transform|animation:/);
    expect(ruleBody(".result-virtual-row")).not.toMatch(/animation:/);
  });

  it("disables theme and dropdown motion under prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, start + 900);
    expect(block).toContain("html");
    expect(block).toContain(".search-dropdown");
    expect(block).toContain(".preview-find-pop");
    expect(block).toContain(".sel-menu");
    expect(block).toContain(".toast-overlay");
    expect(block).toContain("animation: none");
  });
});
