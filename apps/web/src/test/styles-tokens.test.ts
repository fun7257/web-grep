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
    expect(ruleBody(".search-go.cancel")).toContain("var(--danger)");
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

  it("lays out the search card, inline filters, and history popover", () => {
    expect(css).not.toContain("--and-row-h:");
    expect(css).not.toContain("--and-mods-w:");
    expect(css).not.toContain("--and-panel-w:");
    expect(css).not.toContain(".search-filter-pop");
    expect(css).not.toContain(".search-drop-backdrop");
    expect(css).not.toContain(".search-filter-limit");

    const card = ruleBody(".search-card");
    expect(card).toContain("background: var(--elev)");
    expect(card).toContain("border: 1px solid var(--line-strong)");
    expect(card).toContain("border-radius: 12px");
    const focus = ruleBody(".search-card:focus-within");
    expect(focus).toContain("border-color: var(--accent)");
    expect(focus).toContain("0 0 0 3px");
    expect(focus).toContain(
      "color-mix(in srgb, var(--accent) 22%, transparent)",
    );
    expect(ruleBody(".search-card.is-locked")).toContain("opacity: 0.55");

    expect(ruleBody(".search-main")).toContain("height: 48px");
    expect(ruleBody(".search-field")).toContain("height: 36px");
    expect(ruleBody(".search-field")).toContain("border-radius: 9px");
    const sharedField = css.slice(
      css.indexOf(".search-field,"),
      css.indexOf(".search-field {"),
    );
    expect(sharedField).toContain("background: var(--bg)");
    expect(sharedField).toContain("border: 1px solid var(--line)");
    const fieldFocus = css.slice(
      css.indexOf(".search-field:focus-within"),
      css.indexOf("}", css.indexOf(".search-field:focus-within")),
    );
    expect(fieldFocus).toContain("border-color: var(--accent)");
    expect(fieldFocus).toContain(
      "color-mix(in srgb, var(--accent) 40%, transparent)",
    );

    const filters = ruleBody(".search-filters");
    expect(filters).toContain("padding: 0 8px 4px 52px");
    expect(filters).toContain("gap: 6px");
    const rail = ruleBody(".search-filters::before");
    expect(rail).toContain("left: 30px");
    expect(rail).toContain("width: 1px");
    expect(rail).toContain("background: var(--line-strong)");
    const tick = ruleBody(".search-filter-row::before");
    expect(tick).toContain("left: -22px");
    expect(tick).toContain("width: 14px");
    expect(tick).toContain("background: var(--line-strong)");
    const filterFieldAt = css.indexOf("\n.search-filter-field {");
    const filterFieldRule = css.indexOf(
      "\n.search-filter-field {",
      filterFieldAt + 1,
    );
    const filterFieldBody = css.slice(
      css.indexOf("{", filterFieldRule) + 1,
      css.indexOf("}", filterFieldRule),
    );
    expect(filterFieldBody).toContain("height: 32px");
    expect(filterFieldBody).toContain("border-radius: 8px");

    expect(ruleBody('.hl-dot[data-tone="0"]')).toContain("var(--hl-0)");
    expect(ruleBody('.hl-dot[data-tone="1"]')).toContain("var(--hl-1)");
    expect(ruleBody('.hl-dot[data-tone="2"]')).toContain("var(--hl-2)");
    expect(ruleBody('.hl-dot[data-tone="3"]')).toContain("var(--hl-3)");

    const go = ruleBody(".search-go");
    expect(go).toContain("height: 34px");
    expect(go).toContain("background: var(--accent)");
    expect(go).toContain("color: var(--accent-ink)");
    const cancel = ruleBody(".search-go.cancel");
    expect(cancel).toContain("color: var(--danger)");
    expect(cancel).toContain(
      "color-mix(in srgb, var(--danger) 45%, transparent)",
    );
    expect(ruleBody(".search-go.cancel:hover:not(:disabled)")).toContain(
      "var(--danger-soft)",
    );

    const kbd = ruleBody(".kbd");
    expect(kbd).toContain("font-family: var(--mono)");
    expect(kbd).toContain("font-size: 11px");
    expect(kbd).toContain("var(--chip-fill)");

    const mods = ruleBody(".search-card .mod-btn");
    expect(mods).toContain("min-width: 26px");
    expect(mods).toContain("height: 24px");
    expect(mods).toContain("border-radius: 6px");
    expect(mods).toContain("font-size: 12px");
    const active = ruleBody(".search-card .mod-btn.active");
    expect(active).toContain("var(--selected)");
    expect(active).toContain("var(--accent)");
    expect(active).toContain(
      "color-mix(in srgb, var(--accent) 40%, transparent)",
    );

    const pop = ruleBody(".search-history-pop");
    expect(pop).toContain("width: min(440px, 100%)");
    expect(pop).toContain("border-radius: 12px");
    expect(pop).toContain("background: var(--elev)");
    expect(pop).toContain("var(--duration)");
    expect(pop).toContain("var(--ease)");
    expect(ruleBody(".search-history-label")).toContain(
      "text-transform: uppercase",
    );
    expect(ruleBody(".search-history-label")).toContain("var(--faint)");
    expect(ruleBody(".search-history-item")).toContain("display: grid");
    expect(ruleBody(".search-history-q")).toContain("font-family: var(--mono)");
    expect(ruleBody(".search-history-meta")).not.toContain("var(--accent)");

    const reducedStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const reduced = css.slice(reducedStart, reducedStart + 900);
    expect(reduced).toContain(".search-card");
    expect(reduced).toContain(".search-dropdown");
    expect(reduced).toContain(".search-history-pop");
    expect(reduced).not.toContain(".search-filter-pop");
    expect(reduced).not.toContain(".search-drop-backdrop");
  });

  it("uses a theme token for Search hover so light ink stays readable", () => {
    const body = ruleBody(".search-go:hover:not(:disabled)");
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
      ".tree-twist:hover",
      '.view-toggle button[aria-pressed="true"]',
      ".fmt-md code",
      ".result-log.selected",
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
    expect(ruleBody(".result-log")).not.toMatch(/transform|animation:/);
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

  it("reveals tree checkboxes on keyboard focus only, not after a mouse click", () => {
    // A clicked button keeps :focus-within, which left the empty box stuck open.
    expect(css).not.toMatch(/\.tree-row[^{,]*:focus-within/);
    expect(css).toContain(".tree-row:has(:focus-visible) .tree-check");
  });

  it("keeps in-list file headers at 36px and light result text at 4.5:1", () => {
    expect(css).not.toMatch(
      /\.result-virtual-row\s+\.result-group-header\s*\{[^}]*height:\s*auto/,
    );
    const header = ruleBody(".result-group-header");
    expect(header).toContain("height: 36px");
    expect(header).toContain("min-height: 36px");
    expect(header).not.toContain("!important");
    expect(ruleBody(".result-group-dir")).toContain("color: var(--faint)");
    expect(ruleBody(".result-log.selected .result-line-pill")).toContain(
      "color: var(--accent)",
    );
    expect(css).toContain(
      'html[data-theme="light"] .result-group-dir {\n  color: var(--muted);',
    );
    expect(css).toContain(
      'html[data-theme="light"] .result-log.selected .result-line-pill {\n  color: var(--accent-hover);',
    );

    const blocks = {
      dark: css.slice(
        css.indexOf('html[data-theme="dark"]'),
        css.indexOf('html[data-theme="light"]'),
      ),
      light: css.slice(css.indexOf('html[data-theme="light"]')),
    };
    const hex = (block: string, name: string): number[] => {
      const m = block.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
      if (m?.[1] === undefined) {
        throw new Error(`missing ${name}`);
      }
      const v = m[1];
      return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
    };
    const lum = ([r, g, b]: number[]): number => {
      const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
    };
    const ratio = (fg: number[], bg: number[]): number => {
      const a = lum(fg);
      const b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    expect(
      ratio(hex(blocks.light, "--muted"), hex(blocks.light, "--bg")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(hex(blocks.light, "--accent-hover"), hex(blocks.light, "--bg")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(hex(blocks.dark, "--faint"), hex(blocks.dark, "--bg")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(hex(blocks.dark, "--accent"), hex(blocks.dark, "--bg")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the primary button text at 4.5:1 or better in both themes", () => {
    const blocks = {
      dark: css.slice(
        css.indexOf('html[data-theme="dark"]'),
        css.indexOf('html[data-theme="light"]'),
      ),
      light: css.slice(css.indexOf('html[data-theme="light"]')),
    };
    const hex = (block: string, name: string): number[] => {
      const m = block.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
      if (m?.[1] === undefined) {
        throw new Error(`missing ${name}`);
      }
      const v = m[1];
      return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
    };
    const lum = ([r, g, b]: number[]): number => {
      const lin = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0);
    };
    for (const [theme, block] of Object.entries(blocks)) {
      for (const bg of ["--accent", "--accent-hover"]) {
        const a = lum(hex(block, "--accent-ink"));
        const b = lum(hex(block, bg));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        expect(ratio, `${theme} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
