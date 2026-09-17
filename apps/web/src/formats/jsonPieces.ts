export const JSON_INDENT = 4;

export type JsonTok = "key" | "str" | "num" | "bool" | "null" | "punct";

export type JsonPiece = {
  kind: "src" | "inj";
  text: string;
  tok?: JsonTok;
  srcStart?: number;
  srcEnd?: number;
};

type ScanTok = {
  type: "ws" | "string" | "number" | "literal" | "punct";
  value: string;
  start: number;
  end: number;
  role?: "key" | "value";
};

function isWs(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

export function tokenizeJson(input: string): ScanTok[] {
  const tokens: ScanTok[] = [];
  let i = 0;
  const stack: Array<"obj" | "arr"> = [];
  let expectKey = true;

  const peek = (): string => input[i] ?? "";

  while (i < input.length) {
    const start = i;
    if (isWs(peek())) {
      while (i < input.length && isWs(peek())) {
        i += 1;
      }
      tokens.push({ type: "ws", value: input.slice(start, i), start, end: i });
      continue;
    }
    const ch = peek();
    if (
      ch === "{" ||
      ch === "}" ||
      ch === "[" ||
      ch === "]" ||
      ch === ":" ||
      ch === ","
    ) {
      tokens.push({ type: "punct", value: ch, start, end: start + 1 });
      if (ch === "{") {
        stack.push("obj");
        expectKey = true;
      } else if (ch === "[") {
        stack.push("arr");
        expectKey = false;
      } else if (ch === "}" || ch === "]") {
        stack.pop();
        expectKey = stack[stack.length - 1] === "obj";
      } else if (ch === ":") {
        expectKey = false;
      } else if (ch === ",") {
        expectKey = stack[stack.length - 1] === "obj";
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < input.length) {
        const cur = peek();
        if (cur === "\\") {
          i += 2;
          continue;
        }
        if (cur === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      const value = input.slice(start, i);
      const parent = stack[stack.length - 1];
      const role: "key" | "value" =
        parent === "obj" && expectKey ? "key" : "value";
      tokens.push({ type: "string", value, start, end: i, role });
      if (role === "key") {
        expectKey = false;
      }
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      i += 1;
      while (i < input.length && /[0-9.eE+-]/.test(peek())) {
        i += 1;
      }
      tokens.push({
        type: "number",
        value: input.slice(start, i),
        start,
        end: i,
      });
      continue;
    }
    if (/[a-z]/.test(ch)) {
      while (i < input.length && /[a-z]/.test(peek())) {
        i += 1;
      }
      const value = input.slice(start, i);
      tokens.push({ type: "literal", value, start, end: i });
      continue;
    }
    i += 1;
    tokens.push({ type: "punct", value: ch, start, end: i });
  }
  return tokens;
}

function tokClass(token: ScanTok): JsonTok {
  if (token.type === "string") {
    return token.role === "key" ? "key" : "str";
  }
  if (token.type === "number") {
    return "num";
  }
  if (token.type === "literal") {
    if (token.value === "null") {
      return "null";
    }
    return "bool";
  }
  return "punct";
}

export function buildJsonPieces(original: string): JsonPiece[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch {
    return null;
  }
  const pretty = JSON.stringify(parsed, null, JSON_INDENT);
  const origToks = tokenizeJson(original).filter(
    (token) => token.type !== "ws",
  );
  const prettyToks = tokenizeJson(pretty);
  const pieces: JsonPiece[] = [];
  let oi = 0;
  for (const pt of prettyToks) {
    if (pt.type === "ws") {
      pieces.push({ kind: "inj", text: pt.value });
      continue;
    }
    const ot = origToks[oi];
    oi += 1;
    if (ot !== undefined && ot.value === pt.value) {
      pieces.push({
        kind: "src",
        text: pt.value,
        tok: tokClass(pt),
        srcStart: ot.start,
        srcEnd: ot.end,
      });
    } else {
      pieces.push({ kind: "src", text: pt.value, tok: tokClass(pt) });
    }
  }
  return pieces;
}

export function compactFromPieces(pieces: JsonPiece[]): string {
  return pieces
    .filter((piece) => piece.kind === "src")
    .map((piece) => piece.text)
    .join("");
}

export function mapCompactToOriginal(
  compact: string,
  original: string,
): string | null {
  if (compact === "") {
    return null;
  }
  for (let start = 0; start < original.length; start++) {
    let from = start;
    if (!isWs(compact[0] ?? "")) {
      while (from < original.length && isWs(original[from] ?? "")) {
        from += 1;
      }
    }
    const end = matchCompactAt(original, from, compact);
    if (end !== null) {
      return original.slice(from, end);
    }
  }
  return null;
}

function matchCompactAt(
  original: string,
  start: number,
  compact: string,
): number | null {
  let o = start;
  let c = 0;
  let inStr = false;
  let esc = false;
  while (c < compact.length) {
    if (!inStr) {
      while (o < original.length && isWs(original[o] ?? "")) {
        o += 1;
      }
    }
    if (o >= original.length) {
      return null;
    }
    const oc = original[o] ?? "";
    const cc = compact[c] ?? "";
    if (oc !== cc) {
      return null;
    }
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (oc === "\\") {
        esc = true;
      } else if (oc === '"') {
        inStr = false;
      }
    } else if (oc === '"') {
      inStr = true;
    }
    o += 1;
    c += 1;
  }
  return o;
}

export function sourceTextFromSelection(root: HTMLElement): string {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) {
    return "";
  }
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return "";
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = "";
  let node = walker.nextNode();
  while (node !== null) {
    if (range.intersectsNode(node)) {
      const parent = node.parentElement;
      if (parent !== null && parent.closest("[data-fmt='inj']") === null) {
        const src = parent.closest("[data-fmt='src']");
        if (src !== null) {
          const text = node.textContent ?? "";
          const from = node === range.startContainer ? range.startOffset : 0;
          const to =
            node === range.endContainer ? range.endOffset : text.length;
          out += text.slice(from, to);
        }
      }
    }
    node = walker.nextNode();
  }
  return out;
}

export function mappedSelection(root: HTMLElement, original: string): string {
  const compact = sourceTextFromSelection(root);
  if (compact === "") {
    return "";
  }
  return mapCompactToOriginal(compact, original) ?? compact;
}
