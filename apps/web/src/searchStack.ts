import type { SearchRequestInput } from "@web-grep/shared";

export type QueryPart = {
  id: string;
  value: string;
};

export type SearchModifiers = {
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export type SearchStack = {
  parts: QueryPart[];
  globInclude: string[];
  globExclude: string[];
  path: string;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  hidden: boolean;
};

let partSeq = 0;

export function newPart(value: string): QueryPart {
  partSeq += 1;
  return { id: `p${partSeq}`, value };
}

export function parseDraft(raw: string): QueryPart | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  return newPart(trimmed);
}

/** Split a search box into AND terms. Spaces stay in the term; only AND splits. */
export function parseQueryInput(raw: string, regex = false): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }
  if (regex) {
    return [trimmed];
  }
  const terms: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  const push = (): void => {
    const value = buf.trim();
    if (value !== "") {
      terms.push(value);
    }
    buf = "";
  };
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? "";
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      const and = trimmed.slice(i).match(/^\s+AND(?:\s+|$)/i);
      if (and !== null) {
        push();
        i += and[0].length - 1;
        continue;
      }
    }
    buf += ch;
  }
  push();
  return terms;
}

export function formatQueryInput(terms: string[]): string {
  if (terms.length <= 1) {
    return terms[0] ?? "";
  }
  return terms
    .map((term) => {
      if (/(^|\s)AND(\s|$)/i.test(term)) {
        return `"${term.replaceAll('"', "")}"`;
      }
      return term;
    })
    .join(" AND ");
}

export function commitDraft(parts: QueryPart[], draft: string): QueryPart[] {
  const part = parseDraft(draft);
  if (part === null) {
    return parts;
  }
  return [...parts, part];
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function permutations(items: string[]): string[][] {
  if (items.length <= 1) {
    return [items];
  }
  const out: string[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i] ?? "";
    const rest = items.filter((_, j) => j !== i);
    for (const perm of permutations(rest)) {
      out.push([head, ...perm]);
    }
  }
  return out;
}

export function stackedQuery(
  terms: string[],
  forceRegex = false,
): { query: string; regex: boolean } {
  const list = terms.map((item) => item.trim()).filter((item) => item !== "");
  if (list.length === 0) {
    return { query: "", regex: forceRegex };
  }
  if (list.length === 1) {
    return { query: list[0] ?? "", regex: forceRegex };
  }
  const escaped = forceRegex ? list : list.map(escapeRegex);
  const orders = escaped.length <= 3 ? permutations(escaped) : [escaped];
  return {
    query: orders.map((order) => order.join(".*")).join("|"),
    regex: true,
  };
}

export function compileParts(
  parts: QueryPart[],
  forceRegex = false,
): {
  query: string;
  regex: boolean;
} {
  return stackedQuery(
    parts.map((part) => part.value),
    forceRegex,
  );
}

export function shQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_./:=+@%,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function joinAbs(root: string, rel: string): string {
  const posix = root.startsWith("/") || !root.includes("\\");
  const sep = posix ? "/" : "\\";
  const base = root.replace(/[/\\]+$/, "");
  const rest = rel.replace(/^[/\\]+/, "").replaceAll(/[/\\]+/g, sep);
  if (rest === "") {
    return base;
  }
  return `${base}${sep}${rest}`;
}

export function toRgShareCommand(opts: {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wordMatch: boolean;
  hidden: boolean;
  absPath: string;
  line?: number;
}): string {
  const args = ["rg", "-n"];
  if (!opts.regex) {
    args.push("-F");
  }
  args.push(opts.caseSensitive ? "-s" : "-i");
  if (opts.wordMatch) {
    args.push("-w");
  }
  if (opts.hidden) {
    args.push("--hidden");
  }
  args.push("--", shQuote(opts.query), shQuote(opts.absPath));
  const command = args.join(" ");
  if (opts.line === undefined || opts.line < 1) {
    return command;
  }
  return `${command} | rg ${shQuote(`^${opts.line}:`)}`;
}

export function toRequest(
  stack: SearchStack,
  extraInclude: string[] = [],
  mtimeAfter?: number,
): SearchRequestInput {
  const compiled = compileParts(stack.parts, stack.regex);
  let globInclude = stack.globInclude;
  let globExclude = stack.globExclude;
  if (extraInclude.length > 0) {
    globInclude = extraInclude;
    globExclude = [];
  }
  return {
    query: compiled.query,
    path: stack.path,
    globInclude,
    globExclude,
    regex: stack.regex || compiled.regex,
    caseSensitive: stack.caseSensitive,
    wordMatch: stack.wordMatch,
    hidden: stack.hidden,
    ...(mtimeAfter !== undefined ? { mtimeAfter } : {}),
  };
}
