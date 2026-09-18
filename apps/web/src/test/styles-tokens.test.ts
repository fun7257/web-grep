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

  it("ships v2 spacing, radius, and selection tokens", () => {
    expect(css).toContain("--s05:");
    expect(css).toContain("--s1:");
    expect(css).toContain("--s4:");
    expect(css).toContain("--r-chip:");
    expect(css).toContain("--r-control:");
    expect(css).toContain("--r-cta:");
    expect(css).toContain("--fs-lg:");
    expect(css).toContain("--selected-bar:");
    const dark = css.slice(
      css.indexOf('html[data-theme="dark"]'),
      css.indexOf('html[data-theme="light"]'),
    );
    const light = css.slice(css.indexOf('html[data-theme="light"]'));
    expect(dark).toContain("--chip-fill:");
    expect(light).toContain("--chip-fill:");
    expect(light).toMatch(/--line:\s*rgb\(28 30 36 \/ 10%\)/);
    expect(ruleBody(".tree-pane")).toContain("flex: 0 0 var(--tree-w)");
    expect(ruleBody(".tree-pane")).not.toContain("border-right:");
    expect(ruleBody(".hits-pane")).not.toContain("border-right:");
    expect(ruleBody(".hits-pane")).not.toContain("border-left:");
    expect(ruleBody(".tree-pane.collapsed")).toContain(
      "border-right: 1px solid var(--line)",
    );
    expect(ruleBody(".result-log.selected")).toContain("var(--accent)");
    expect(ruleBody(".exclude-chip")).toContain("var(--chip-fill)");
    expect(ruleBody(".empty-title")).toContain("var(--fs-lg)");
    expect(ruleBody(".empty-helper")).toContain("var(--fs-xs)");
    expect(ruleBody(".empty-detail")).toContain("var(--fs-xs)");
    expect(light).toContain("--warn-bg:");
    expect(dark).toContain("--warn-bg:");
    expect(ruleBody(".warn-banner")).toContain("var(--warn-bg)");
    expect(ruleBody(".search-bar .search-go.cancel")).toContain(
      "var(--danger)",
    );
    expect(css).toContain(".app.app-dimmed");
    expect(css).toContain("--rail-w:");
    expect(css).toContain("--modal-xl:");
    expect(css).toMatch(/--splitter-hit:\s*6px/);
    expect(dark).toContain("--info-bg:");
    expect(light).toContain("--info-bg:");
    expect(dark).toContain("--toast-bg:");
    expect(light).toContain("--toast-bg:");
    expect(ruleBody(".tree-pane.collapsed")).toContain("var(--rail-w)");
    expect(ruleBody(".rail-expand")).toContain("var(--icon-hit)");
    expect(ruleBody(".rail-picked-badge")).toContain("var(--chip-fill)");
    expect(ruleBody(".rail-time-btn.is-active")).toContain("var(--selected)");
    expect(ruleBody(".tree-row.picked")).toContain("var(--selected)");
    expect(ruleBody(".tree-row.picked")).not.toMatch(
      /var\(--(hover|chip-fill|bg-subtle)\)/,
    );
    expect(ruleBody(".tree-row.picked:hover")).toContain("var(--selected)");
    expect(ruleBody(".tree-pick")).toContain("margin-left: auto");
    expect(ruleBody(".pick-chip")).toContain("var(--selected)");
    expect(ruleBody(".pick-chip")).not.toMatch(
      /var\(--(hover|chip-fill|bg-subtle|muted)\)/,
    );
    expect(ruleBody(".pick-chip-x")).toContain("border: 0");
    expect(ruleBody(".pick-chip-x")).toContain("background: transparent");
    expect(ruleBody(".pick-chip-x")).toContain("padding: 0");
    expect(ruleBody(".locale-cycle")).toContain("var(--icon-hit)");
    expect(ruleBody(".rail-stack")).toContain("flex-direction: column");
    expect(ruleBody(".tree-pane.collapsed .tree-foot")).toContain(
      "flex-direction: column",
    );
    expect(css).toContain("width: min(var(--modal-xl), 92vw)");
    expect(ruleBody(".splitter")).toContain("width: var(--splitter-hit)");
    expect(ruleBody(".info-cue")).toContain("var(--info-bg)");
    expect(ruleBody(".toast-pill")).toContain("var(--toast-bg)");
  });

  it("gives each pane seam a single overlay owner (PANE-SEAMS / baseline 46)", () => {
    const tree = ruleBody(".tree-pane");
    const hits = ruleBody(".hits-pane");
    const previewIdx = css.lastIndexOf("\n.preview-pane {");
    expect(previewIdx).toBeGreaterThan(-1);
    const preview = css.slice(
      css.indexOf("{", previewIdx) + 1,
      css.indexOf("}", previewIdx),
    );
    const splitter = ruleBody(".splitter");
    const stroke = ruleBody(".splitter::before");
    const hoverIdx = css.indexOf(".splitter:hover::before");
    expect(hoverIdx).toBeGreaterThan(-1);
    const hoverStroke = css.slice(
      css.indexOf("{", hoverIdx) + 1,
      css.indexOf("}", hoverIdx),
    );

    expect(tree).toContain("background: var(--bg-subtle)");
    expect(tree).not.toMatch(/border-(right|left):/);
    expect(hits).toContain("background: var(--bg)");
    expect(hits).not.toMatch(/border-(right|left):/);
    expect(preview).toContain("background: var(--bg-preview)");
    expect(preview).not.toMatch(/border-(right|left):/);

    expect(splitter).toContain("width: var(--splitter-hit)");
    expect(splitter).toContain("margin: 0 calc(var(--splitter-hit) / -2)");
    expect(splitter).toContain("background: transparent");
    expect(splitter).toMatch(/border:\s*0/);
    expect(splitter).not.toMatch(/border-(left|right):/);

    expect(stroke).toContain("width: 1px");
    expect(stroke).toContain("background: var(--line)");
    expect(hoverStroke).toContain("width: 3px");
    expect(hoverStroke).toContain("background: var(--accent)");
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

  it("anchors the S-AND filter panel to the search field and funnel, not a fixed card", () => {
    expect(css).toContain("--and-mods-w:");
    expect(css).toContain("--and-row-h:");
    expect(css).toContain("--and-row-gap:");
    expect(css).toContain("--and-mods-gap:");
    expect(css).not.toContain("--and-panel-w:");
    expect(css).not.toContain("--and-panel-min:");
    expect(css).not.toContain("--and-panel-max:");
    const root = css.slice(0, css.indexOf('html[data-theme="dark"]'));
    expect(root).toMatch(/--and-row-h:\s*40px/);
    expect(root).toMatch(/--and-row-gap:\s*10px/);
    expect(root).toMatch(/--and-mods-gap:\s*12px/);
    expect(root).toMatch(/--and-mods-w:\s*72px/);
    const panel = ruleBody(".search-and-pop");
    expect(panel).toContain("width: calc(100% + var(--s1) + var(--search-h))");
    expect(panel).toContain("min-width: 0");
    expect(panel).toContain("overflow-x: hidden");
    expect(panel).toContain("background: var(--elev)");
    expect(ruleBody(".hits-pane")).toContain("overflow: hidden");
    expect(panel).not.toContain("right: 0");
    expect(panel).not.toMatch(/480px|508px|520px/);
    const row = ruleBody(".search-and-row");
    expect(row).toContain("minmax(0, 1fr) var(--and-mods-w)");
    expect(row).toContain("calc(var(--filter-remove) + 6px)");
    expect(row).toContain("column-gap: var(--and-mods-gap)");
    expect(row).toContain("background: transparent");
    expect(ruleBody(".search-and-row:focus-within")).toContain(
      "background: transparent",
    );
    const field = ruleBody(".search-and-field");
    expect(field).toContain("min-width: 0");
    expect(field).toContain("height: var(--and-row-h)");
    expect(field).toContain("background: var(--bg)");
    expect(field).toContain("border: 1px solid var(--line-strong)");
    const focus = ruleBody(".search-and-field:focus-within");
    expect(focus).toContain("border: 1.5px solid var(--accent)");
    expect(focus).toMatch(/box-shadow:\s*none/);
    expect(focus).not.toContain("0 0 0 0.5px");
    expect(focus).not.toContain("var(--glow)");
    expect(focus).not.toContain("3px");
    const focused = ruleBody(".search-and-field.is-focused");
    expect(focused).toContain("border: 1.5px solid var(--accent)");
    expect(focused).toMatch(/box-shadow:\s*none/);
    expect(focused).not.toContain("0 0 0 0.5px");
    expect(focused).not.toContain("var(--glow)");
    expect(focused).not.toContain("3px");
    expect(ruleBody('html[data-theme="light"] .search-and-field')).toContain(
      "border-color: var(--line-strong)",
    );
    const lightFocus = ruleBody(
      'html[data-theme="light"] .search-and-field:focus-within',
    );
    expect(lightFocus).toContain("border: 1.5px solid var(--accent)");
    expect(lightFocus).toMatch(/box-shadow:\s*none/);
    expect(lightFocus).not.toContain("0 0 0 0.5px");
    const lightFocused = ruleBody(
      'html[data-theme="light"] .search-and-field.is-focused',
    );
    expect(lightFocused).toContain("border: 1.5px solid var(--accent)");
    expect(lightFocused).toMatch(/box-shadow:\s*none/);
    const input = ruleBody(".search-and-field input");
    expect(input).toContain("min-width: 0");
    expect(input).toContain("text-overflow: ellipsis");
    expect(input).not.toContain("text-overflow: clip");
    const mods = ruleBody(".search-and-mods");
    expect(mods).toContain("width: var(--and-mods-w)");
    expect(mods).toContain("min-width: var(--and-mods-w)");
    expect(mods).toContain("height: var(--and-row-h)");
    expect(mods).toContain("background: transparent");
    expect(mods).not.toContain("border: 1px");
    expect(ruleBody(".search-and-mods .mod-btn")).toContain("min-width: 22px");
    expect(css).not.toContain(".search-and-item:first-child .search-and-join");
    expect(css).not.toContain(
      ".search-and-item:first-child .search-and-line:first-of-type",
    );
    const join = ruleBody(".search-and-join");
    expect(join).toContain("flex-direction: row");
    expect(join).not.toContain("flex-direction: column");
    expect(join).not.toContain("margin-right: calc(");
    const line = ruleBody(".search-and-line");
    expect(line).toMatch(/border-top:\s*1px dashed var\(--line-strong\)/);
    expect(line).toContain("border-left: none");
    expect(line).not.toContain("border-left: 1.5px");
    expect(line).not.toContain("var(--accent)");
    expect(ruleBody(".search-field-remove")).toContain("margin: 0 0 0 6px");
    const foot = ruleBody(".search-and-foot");
    expect(foot).toContain("justify-content: space-between");
    expect(foot).toContain("flex-direction: row");
    expect(foot).not.toContain("flex-direction: column");
    const hint = ruleBody(".search-and-hint");
    expect(hint).toContain("flex: 1 1 auto");
    expect(hint).toContain("text-align: left");
    const actions = ruleBody(".search-and-actions");
    expect(actions).toContain("flex: none");
    expect(actions).toContain("gap: 8px");
    const more = ruleBody(".search-and-more");
    expect(more).toMatch(/flex:\s*none/);
    expect(more).toContain("width: auto");
    expect(more).toContain("height: 32px");
    expect(more).not.toMatch(/flex:\s*1/);
    expect(ruleBody(".search-and-go")).toContain("height: 32px");
    expect(ruleBody(".search-and-go")).toContain("flex: none");
    const light = css.slice(css.indexOf('html[data-theme="light"]'));
    expect(light).toContain('html[data-theme="light"] .search-and-badge');
    expect(light).toContain(
      'html[data-theme="light"] .search-and-more:disabled',
    );
    expect(ruleBody(".search-and-more:disabled")).toContain("var(--chip-fill)");
    expect(ruleBody(".search-and-go:hover:not(:disabled)")).toContain(
      "var(--accent-hover)",
    );
  });

  it("uses a theme token for Search hover so light ink stays readable", () => {
    const body = ruleBody(".search-bar .search-go:hover:not(:disabled)");
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
