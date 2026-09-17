import type { SearchRequestInput } from "@web-grep/shared";
import type { TimeRange } from "./timeRange.ts";

export type SearchModifiers = {
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export const DEFAULT_MODIFIERS: SearchModifiers = {
  caseSensitive: false,
  wordMatch: false,
  regex: false,
};

export type QueryPart = {
  id: string;
  value: string;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export type SearchStack = {
  parts: QueryPart[];
  globInclude: string[];
  globAnd: string[];
  globExclude: string[];
  path: string;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  hidden: boolean;
};

let partSeq = 0;

export function newPart(
  value: string,
  mods: Partial<SearchModifiers> = {},
): QueryPart {
  partSeq += 1;
  return {
    id: `p${partSeq}`,
    value,
    caseSensitive: mods.caseSensitive ?? false,
    wordMatch: mods.wordMatch ?? false,
    regex: mods.regex ?? false,
  };
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

/** First term is the rg source; extra terms are piped `rg | rg`. */
export function splitAndTerms(
  parts: string[],
  _regex = false,
): { query: string; andTerms: string[] } {
  const list = parts.map((item) => item.trim()).filter((item) => item !== "");
  if (list.length <= 1) {
    return { query: list[0] ?? "", andTerms: [] };
  }
  return { query: list[0] ?? "", andTerms: list.slice(1) };
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

export function findMtimePredicate(range: TimeRange): string {
  switch (range) {
    case "today":
      return "-mmin -$(( $(date +%H) * 60 + $(date +%M) + 1 ))";
    case "24h":
      return "-mmin -1440";
    case "7d":
      return "-mtime -7";
  }
}

function rgContentFlags(
  opts: {
    regex: boolean;
    caseSensitive: boolean;
    wordMatch: boolean;
    hidden: boolean;
  },
  stage: "head" | "filter",
): string[] {
  const args: string[] = [];
  if (stage === "head") {
    args.push("-n");
  }
  if (!opts.regex) {
    args.push("-F");
  }
  args.push(opts.caseSensitive ? "-s" : "-i");
  if (opts.wordMatch) {
    args.push("-w");
  }
  if (stage === "head" && opts.hidden) {
    args.push("--hidden");
  }
  return args;
}

export type AndTermShare = {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wordMatch?: boolean;
};

export function toRgShareCommand(opts: {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wordMatch: boolean;
  hidden: boolean;
  rootAbs: string;
  relPaths: string[];
  andTerms?: Array<string | AndTermShare>;
  line?: number;
}): string {
  const pathArgs = [
    ...new Set(
      opts.relPaths
        .map((path) => path.trim())
        .filter((path) => path !== "")
        .map((path) => joinAbs(opts.rootAbs, path)),
    ),
  ].map(shQuote);
  const headFlags = rgContentFlags(opts, "head");
  const query = shQuote(opts.query);
  const extraAnd = (opts.andTerms ?? [])
    .map((term) => {
      if (typeof term === "string") {
        return { query: term, regex: opts.regex, caseSensitive: opts.caseSensitive, wordMatch: opts.wordMatch };
      }
      return {
        query: term.query,
        regex: term.regex ?? false,
        caseSensitive: term.caseSensitive ?? false,
        wordMatch: term.wordMatch ?? false,
      };
    })
    .map((term) => ({ ...term, query: term.query.trim() }))
    .filter((term) => term.query !== "")
    .map((term) => {
      const flags = rgContentFlags(
        {
          regex: term.regex,
          caseSensitive: term.caseSensitive,
          wordMatch: term.wordMatch,
          hidden: false,
        },
        "filter",
      );
      return `| rg ${flags.join(" ")} -- ${shQuote(term.query)}`;
    })
    .join(" ");
  const lineLock =
    opts.line !== undefined && opts.line > 0
      ? ` | rg ${shQuote(`^${opts.line}:`)} -r ''`
      : "";
  const pipeAnd = extraAnd === "" ? "" : ` ${extraAnd}`;
  return `${["rg", ...headFlags, "--", query, ...pathArgs].join(" ")}${pipeAnd}${lineLock}`;
}

export function toRequest(
  stack: SearchStack,
  extraInclude: string[] = [],
  mtimeAfter?: number,
): SearchRequestInput {
  const ready = stack.parts
    .map((part) => ({ ...part, value: part.value.trim() }))
    .filter((part) => part.value !== "");
  const head = ready[0];
  const rest = ready.slice(1);
  let globInclude = stack.globInclude;
  const globAnd = stack.globAnd;
  let globExclude = stack.globExclude;
  if (extraInclude.length > 0) {
    globInclude = extraInclude;
  }
  if (head === undefined) {
    return {
      query: "",
      path: stack.path,
      globInclude,
      globAnd,
      globExclude,
      regex: stack.regex,
      caseSensitive: stack.caseSensitive,
      wordMatch: stack.wordMatch,
      hidden: stack.hidden,
      ...(mtimeAfter !== undefined ? { mtimeAfter } : {}),
    };
  }
  return {
    query: head.value,
    path: stack.path,
    globInclude,
    globAnd,
    globExclude,
    regex: head.regex,
    caseSensitive: head.caseSensitive,
    wordMatch: head.wordMatch,
    hidden: stack.hidden,
    ...(rest.length > 0
      ? {
          andTerms: rest.map((part) => ({
            query: part.value,
            regex: part.regex,
            caseSensitive: part.caseSensitive,
            wordMatch: part.wordMatch,
          })),
        }
      : {}),
    ...(mtimeAfter !== undefined ? { mtimeAfter } : {}),
  };
}
