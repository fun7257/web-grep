import { escapeRegExp } from "./highlight.ts";

export type FindSpan = { start: number; end: number };

export type FindOpts = {
  caseSensitive: boolean;
  wordMatch: boolean;
};

export function findAll(
  haystack: string,
  needle: string,
  opts: FindOpts,
): FindSpan[] {
  if (needle === "") {
    return [];
  }
  if (opts.wordMatch) {
    const flags = opts.caseSensitive ? "g" : "gi";
    try {
      const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, flags);
      const out: FindSpan[] = [];
      let match = re.exec(haystack);
      while (match !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (end > start) {
          out.push({ start, end });
          re.lastIndex = end;
        } else {
          re.lastIndex += 1;
        }
        match = re.exec(haystack);
      }
      return out;
    } catch {
      // fall through to literal
    }
  }
  const hay = opts.caseSensitive ? haystack : haystack.toLowerCase();
  const ned = opts.caseSensitive ? needle : needle.toLowerCase();
  const out: FindSpan[] = [];
  let from = 0;
  while (from <= hay.length - ned.length) {
    const at = hay.indexOf(ned, from);
    if (at === -1) {
      break;
    }
    out.push({ start: at, end: at + ned.length });
    from = at + ned.length;
  }
  return out;
}

type NodeSlice = { node: Text; start: number; end: number };

export function collectSearchText(root: HTMLElement): {
  flat: string;
  slices: NodeSlice[];
} {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const slices: NodeSlice[] = [];
  let flat = "";
  let node = walker.nextNode();
  while (node !== null) {
    const text = node as Text;
    const parent = text.parentElement;
    if (
      parent !== null &&
      parent.closest(".preview-n, .preview-find") === null
    ) {
      const value = text.data;
      if (value.length > 0) {
        slices.push({
          node: text,
          start: flat.length,
          end: flat.length + value.length,
        });
        flat += value;
      }
    }
    node = walker.nextNode();
  }
  return { flat, slices };
}

function locate(
  slices: NodeSlice[],
  index: number,
  atEnd: boolean,
): { node: Text; offset: number } | null {
  for (const slice of slices) {
    if (index >= slice.start && index < slice.end) {
      return { node: slice.node, offset: index - slice.start };
    }
    if (atEnd && index === slice.end) {
      return { node: slice.node, offset: slice.node.data.length };
    }
  }
  if (atEnd && slices.length > 0) {
    const last = slices[slices.length - 1];
    if (last !== undefined && index === last.end) {
      return { node: last.node, offset: last.node.data.length };
    }
  }
  return null;
}

export function findTextRanges(
  root: HTMLElement,
  query: string,
  opts: FindOpts,
): Range[] {
  if (query === "") {
    return [];
  }
  const { flat, slices } = collectSearchText(root);
  const hits = findAll(flat, query, opts);
  const ranges: Range[] = [];
  for (const hit of hits) {
    const startPos = locate(slices, hit.start, false);
    const endPos = locate(slices, hit.end, true);
    if (startPos === null || endPos === null) {
      continue;
    }
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    ranges.push(range);
  }
  return ranges;
}

const FIND_NAME = "web-grep-find";
const FIND_CURRENT = "web-grep-find-current";

export function paintFindRanges(ranges: Range[], current: number): void {
  const api = (
    globalThis as unknown as {
      CSS?: { highlights?: Map<string, Highlight> };
    }
  ).CSS;
  if (api?.highlights === undefined || typeof Highlight !== "function") {
    const range = ranges[current];
    if (range !== undefined) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return;
  }
  api.highlights.set(FIND_NAME, new Highlight(...ranges));
  const active = ranges[current];
  if (active !== undefined) {
    api.highlights.set(FIND_CURRENT, new Highlight(active));
  } else {
    api.highlights.delete(FIND_CURRENT);
  }
}

export function clearFindPaint(): void {
  const api = (
    globalThis as unknown as {
      CSS?: { highlights?: Map<string, Highlight> };
    }
  ).CSS;
  api?.highlights?.delete(FIND_NAME);
  api?.highlights?.delete(FIND_CURRENT);
}

export function wrapIndex(index: number, count: number, delta: number): number {
  if (count <= 0) {
    return 0;
  }
  return (index + delta + count * 8) % count;
}
