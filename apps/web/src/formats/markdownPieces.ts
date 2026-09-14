import { marked, Renderer, type Token, type Tokens } from "marked";
import {
  HL_TONES,
  type HlOpts,
  type HlSpan,
  highlightSpans,
} from "../highlight.ts";
import { sourceTextFromSelection } from "./jsonPieces.ts";

type OffsetTok = {
  _s?: number;
  _e?: number;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function attachMarkdownOffsets(
  tokens: Token[],
  original: string,
  from = 0,
): number {
  let cursor = from;
  for (const token of tokens) {
    const raw = typeof token.raw === "string" ? token.raw : "";
    const tagged = token as Token & OffsetTok;
    if (raw !== "") {
      const idx = original.indexOf(raw, cursor);
      if (idx >= 0) {
        tagged._s = idx;
        tagged._e = idx + raw.length;
        cursor = idx + raw.length;
      }
    }
    const nestedFrom = tagged._s ?? cursor;
    if ("tokens" in token && Array.isArray(token.tokens)) {
      attachMarkdownOffsets(token.tokens, original, nestedFrom);
    }
    if (token.type === "list") {
      const list = token as Tokens.List;
      let itemCursor = nestedFrom;
      for (const item of list.items) {
        const itemTagged = item as Tokens.ListItem & OffsetTok;
        if (item.raw !== "") {
          const idx = original.indexOf(item.raw, itemCursor);
          if (idx >= 0) {
            itemTagged._s = idx;
            itemTagged._e = idx + item.raw.length;
            itemCursor = idx + item.raw.length;
          }
        }
        attachMarkdownOffsets(
          item.tokens,
          original,
          itemTagged._s ?? itemCursor,
        );
      }
    }
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of table.header) {
        attachMarkdownOffsets(cell.tokens, original, nestedFrom);
      }
      for (const row of table.rows) {
        for (const cell of row) {
          attachMarkdownOffsets(cell.tokens, original, nestedFrom);
        }
      }
    }
  }
  return cursor;
}

function wrapTag(html: string, token: object): string {
  const tagged = token as OffsetTok;
  if (tagged._s === undefined || tagged._e === undefined) {
    return html;
  }
  return html.replace(
    /^(\s*)<([A-Za-z][\w-]*)/,
    `$1<$2 data-md-start="${tagged._s}" data-md-end="${tagged._e}" data-fmt="src"`,
  );
}

function wrapSpan(html: string, token: object): string {
  const tagged = token as OffsetTok;
  if (tagged._s === undefined || tagged._e === undefined) {
    return html;
  }
  return `<span data-md-start="${tagged._s}" data-md-end="${tagged._e}" data-fmt="src">${html}</span>`;
}

class OffsetRenderer extends Renderer {
  override heading(token: Tokens.Heading): string {
    return wrapTag(super.heading(token), token);
  }
  override paragraph(token: Tokens.Paragraph): string {
    return wrapTag(super.paragraph(token), token);
  }
  override blockquote(token: Tokens.Blockquote): string {
    return wrapTag(super.blockquote(token), token);
  }
  override list(token: Tokens.List): string {
    return wrapTag(super.list(token), token);
  }
  override listitem(token: Tokens.ListItem): string {
    return wrapTag(super.listitem(token), token);
  }
  override code(token: Tokens.Code): string {
    return wrapTag(super.code(token), token);
  }
  override codespan(token: Tokens.Codespan): string {
    return wrapTag(super.codespan(token), token);
  }
  override strong(token: Tokens.Strong): string {
    return wrapTag(super.strong(token), token);
  }
  override em(token: Tokens.Em): string {
    return wrapTag(super.em(token), token);
  }
  override del(token: Tokens.Del): string {
    return wrapTag(super.del(token), token);
  }
  override link(token: Tokens.Link): string {
    return wrapTag(super.link(token), token);
  }
  override image(token: Tokens.Image): string {
    return wrapTag(super.image(token), token);
  }
  override hr(token: Tokens.Hr): string {
    return wrapTag(super.hr(token), token);
  }
  override table(token: Tokens.Table): string {
    return wrapTag(super.table(token), token);
  }
  override tablecell(token: Tokens.TableCell): string {
    return wrapTag(super.tablecell(token), token);
  }
  override html(token: Tokens.HTML | Tokens.Tag): string {
    return wrapTag(super.html(token), token);
  }
  override text(token: Tokens.Text | Tokens.Escape): string {
    return wrapSpan(super.text(token), token);
  }
}

export function renderMarkdownWithOffsets(original: string): string {
  const tokens = marked.lexer(original, { gfm: true });
  attachMarkdownOffsets(tokens, original, 0);
  const renderer = new OffsetRenderer();
  return marked.parser(tokens, { renderer, gfm: true });
}

function applyMarks(
  decoded: string,
  origFrom: number,
  spans: HlSpan[],
): string {
  const origTo = origFrom + decoded.length;
  const locals: HlSpan[] = [];
  for (const span of spans) {
    const start = Math.max(span.start, origFrom) - origFrom;
    const end = Math.min(span.end, origTo) - origFrom;
    if (end > start) {
      locals.push({ start, end, tone: span.tone });
    }
  }
  if (locals.length === 0) {
    return escapeHtml(decoded);
  }
  let html = "";
  let cursor = 0;
  for (const span of locals) {
    html += escapeHtml(decoded.slice(cursor, span.start));
    html += `<mark class="hl-${span.tone % HL_TONES}">${escapeHtml(decoded.slice(span.start, span.end))}</mark>`;
    cursor = span.end;
  }
  html += escapeHtml(decoded.slice(cursor));
  return html;
}

export function annotateMarkdownHtml(
  html: string,
  original: string,
  opts: HlOpts,
  terms: string[],
): string {
  const spans = highlightSpans(original, terms, opts);
  let cursor = 0;
  return html
    .split(/(<[^>]+>)/)
    .map((chunk) => {
      if (chunk === "" || chunk.startsWith("<")) {
        return chunk;
      }
      const decoded = decodeEntities(chunk);
      let idx = original.indexOf(decoded, cursor);
      if (idx < 0) {
        idx = original.indexOf(decoded);
      }
      const from = idx >= 0 ? idx : cursor;
      if (idx >= 0) {
        cursor = idx + decoded.length;
      }
      return applyMarks(decoded, from, spans);
    })
    .join("");
}

function innermostTagged(node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest("[data-md-start]") ?? null;
}

function visibleOffset(tagged: HTMLElement, node: Node, offset: number): number {
  const prefix = document.createRange();
  prefix.setStart(tagged, 0);
  try {
    prefix.setEnd(node, offset);
  } catch {
    return 0;
  }
  return prefix.toString().length;
}

function mapVisibleToSrc(
  raw: string,
  visible: string,
  visOff: number,
): number {
  const clamped = Math.max(0, Math.min(visible.length, visOff));
  if (visible.length === 0 || raw.length === 0) {
    return 0;
  }
  const at = raw.indexOf(visible);
  if (at >= 0) {
    return at + clamped;
  }
  let vi = 0;
  for (let i = 0; i < raw.length; i++) {
    if (vi === clamped) {
      return i;
    }
    if (vi < visible.length && raw[i] === visible[vi]) {
      vi += 1;
    }
  }
  return raw.length;
}

function caretToSrc(
  node: Node,
  offset: number,
  original: string,
  root: HTMLElement,
): number | null {
  const tagged = innermostTagged(node);
  if (tagged === null || tagged === root) {
    if (node !== root && !root.contains(node)) {
      return null;
    }
    const atStart =
      offset <= 0 && (node === root || node === root.firstChild);
    if (atStart) {
      const first = root.querySelector("[data-md-start]");
      const start = Number(first?.getAttribute("data-md-start"));
      return Number.isFinite(start) ? start : 0;
    }
    const all = root.querySelectorAll("[data-md-start]");
    const last = all[all.length - 1];
    const end = Number(last?.getAttribute("data-md-end"));
    return Number.isFinite(end) ? end : original.length;
  }
  const srcStart = Number(tagged.getAttribute("data-md-start"));
  const srcEnd = Number(tagged.getAttribute("data-md-end"));
  if (!Number.isFinite(srcStart) || !Number.isFinite(srcEnd) || srcEnd < srcStart) {
    return null;
  }
  const visible = tagged.textContent ?? "";
  const visOff = visibleOffset(tagged, node, offset);
  const raw = original.slice(srcStart, srcEnd);
  return srcStart + mapVisibleToSrc(raw, visible, visOff);
}

export function markdownRangeFromSelection(
  root: HTMLElement,
  original: string,
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const start = caretToSrc(
    range.startContainer,
    range.startOffset,
    original,
    root,
  );
  const end = caretToSrc(
    range.endContainer,
    range.endOffset,
    original,
    root,
  );
  if (start === null || end === null) {
    return null;
  }
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  if (hi <= lo) {
    return null;
  }
  return { start: lo, end: hi };
}

export function mappedMarkdownSelection(
  root: HTMLElement,
  original: string,
): string {
  const range = markdownRangeFromSelection(root, original);
  if (range !== null) {
    return original.slice(range.start, range.end);
  }
  return sourceTextFromSelection(root).trim();
}
