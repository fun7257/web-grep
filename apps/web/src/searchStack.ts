import type { SearchRequestInput } from "@web-grep/shared";

export type SearchModifiers = {
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
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
  globIntersect: string[];
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

/** Funnel / rail badge: extra filter rows with a non-empty trimmed value. */
export function countFilledFilters(
  parts: ReadonlyArray<Pick<QueryPart, "value">>,
): number {
  return parts.slice(1).filter((part) => part.value.trim() !== "").length;
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

export type FilterShare = {
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
  filterTerms?: Array<string | FilterShare>;
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
  const extraAnd = (opts.filterTerms ?? [])
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
  const globIntersect = stack.globIntersect;
  let globExclude = stack.globExclude;
  if (extraInclude.length > 0) {
    globInclude = extraInclude;
  }
  if (head === undefined) {
    return {
      query: "",
      path: stack.path,
      globInclude,
      globIntersect,
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
    globIntersect,
    globExclude,
    regex: head.regex,
    caseSensitive: head.caseSensitive,
    wordMatch: head.wordMatch,
    hidden: stack.hidden,
    ...(rest.length > 0
      ? {
          filterTerms: rest.map((part) => ({
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
