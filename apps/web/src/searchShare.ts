import type { SearchModifiers } from "./searchStack.ts";
import { isTimeRange, type TimeRange } from "./timeRange.ts";
import type { TreePick } from "./treePicks.ts";

export type SharePart = {
  value: string;
} & SearchModifiers;

export type ShareState = {
  parts: string[];
  mods?: SearchModifiers[];
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  path?: string;
  line?: number;
  timeRange?: TimeRange;
  excludeGlobs?: string;
  picks?: TreePick[];
};

function encodeMod(mod: SearchModifiers): string {
  return `${mod.caseSensitive ? "s" : ""}${mod.wordMatch ? "w" : ""}${mod.regex ? "r" : ""}`;
}

function decodeMod(raw: string | null | undefined): SearchModifiers {
  const flags = raw ?? "";
  return {
    caseSensitive: flags.includes("s"),
    wordMatch: flags.includes("w"),
    regex: flags.includes("r"),
  };
}

function sameMods(a: SearchModifiers, b: SearchModifiers): boolean {
  return (
    a.caseSensitive === b.caseSensitive &&
    a.wordMatch === b.wordMatch &&
    a.regex === b.regex
  );
}

function joinedParam(params: URLSearchParams, key: string): string {
  return params
    .getAll(key)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(", ");
}

function trimmedList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function captureShareState(input: {
  fields: SharePart[];
  fallbackParts?: SharePart[];
  excludeGlobs: string;
  picks: TreePick[];
  timeRange: TimeRange | null;
  hitPath?: string;
  hitLine?: number;
}): ShareState | null {
  const live = input.fields
    .map((part) => ({ ...part, value: part.value.trim() }))
    .filter((part) => part.value !== "");
  const fallback = (input.fallbackParts ?? [])
    .map((part) => ({ ...part, value: part.value.trim() }))
    .filter((part) => part.value !== "");
  const query = live.length > 0 ? live : fallback;
  if (query.length === 0) {
    return null;
  }
  const excludeGlobs = input.excludeGlobs.trim();
  const hitPath = input.hitPath?.trim() ?? "";
  const hitLine = input.hitLine ?? 0;
  const head = query[0] ?? {
    value: "",
    caseSensitive: false,
    wordMatch: false,
    regex: false,
  };
  return {
    parts: query.map((part) => part.value),
    mods: query.map((part) => ({
      caseSensitive: part.caseSensitive,
      wordMatch: part.wordMatch,
      regex: part.regex,
    })),
    caseSensitive: head.caseSensitive,
    wordMatch: head.wordMatch,
    regex: head.regex,
    ...(hitPath !== "" ? { path: hitPath } : {}),
    ...(Number.isInteger(hitLine) && hitLine > 0 ? { line: hitLine } : {}),
    ...(input.timeRange !== null ? { timeRange: input.timeRange } : {}),
    ...(excludeGlobs !== "" ? { excludeGlobs } : {}),
    ...(input.picks.length > 0 ? { picks: input.picks } : {}),
  };
}

export function parseShareSearch(search: string): ShareState | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (raw === "") {
    return null;
  }
  const params = new URLSearchParams(raw);
  const parts = trimmedList(params.getAll("q"));
  if (parts.length === 0) {
    return null;
  }
  const path = params.get("p")?.trim() ?? "";
  const lineRaw = params.get("n");
  const line =
    lineRaw !== null && lineRaw !== "" ? Number(lineRaw) : Number.NaN;
  const timeRaw = params.get("t");
  const excludeGlobs = joinedParam(params, "x");
  const picks: TreePick[] = [
    ...trimmedList(params.getAll("f")).map((item) => ({
      path: item,
      dir: false,
    })),
    ...trimmedList(params.getAll("d")).map((item) => ({
      path: item === "." ? "" : item,
      dir: true,
    })),
  ];
  const globalMods: SearchModifiers = {
    caseSensitive: params.get("s") === "1",
    wordMatch: params.get("w") === "1",
    regex: params.get("r") === "1",
  };
  const flagged = params.getAll("m");
  const mods = parts.map((_, index) =>
    flagged.length > 0 ? decodeMod(flagged[index]) : globalMods,
  );
  const head = mods[0] ?? globalMods;
  return {
    parts,
    mods,
    caseSensitive: head.caseSensitive,
    wordMatch: head.wordMatch,
    regex: head.regex,
    ...(path !== "" ? { path } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(isTimeRange(timeRaw) ? { timeRange: timeRaw } : {}),
    ...(excludeGlobs !== "" ? { excludeGlobs } : {}),
    ...(picks.length > 0 ? { picks } : {}),
  };
}

export function buildShareUrl(href: string, state: ShareState): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  for (const part of state.parts) {
    const trimmed = part.trim();
    if (trimmed !== "") {
      url.searchParams.append("q", trimmed);
    }
  }
  const mods =
    state.mods !== undefined && state.mods.length === state.parts.length
      ? state.mods
      : state.parts.map(() => ({
          caseSensitive: state.caseSensitive,
          wordMatch: state.wordMatch,
          regex: state.regex,
        }));
  const mixed = mods.some((mod) => !sameMods(mod, mods[0] ?? mod));
  if (mixed) {
    for (const mod of mods) {
      url.searchParams.append("m", encodeMod(mod));
    }
  } else {
    const head = mods[0];
    if (head?.caseSensitive) {
      url.searchParams.set("s", "1");
    }
    if (head?.wordMatch) {
      url.searchParams.set("w", "1");
    }
    if (head?.regex) {
      url.searchParams.set("r", "1");
    }
  }
  if (state.path !== undefined && state.path !== "") {
    url.searchParams.set("p", state.path);
  }
  if (state.line !== undefined && state.line > 0) {
    url.searchParams.set("n", String(state.line));
  }
  if (state.timeRange !== undefined) {
    url.searchParams.set("t", state.timeRange);
  }
  const excludeGlobs = state.excludeGlobs?.trim() ?? "";
  if (excludeGlobs !== "") {
    url.searchParams.set("x", excludeGlobs);
  }
  for (const pick of state.picks ?? []) {
    if (pick.dir) {
      url.searchParams.append("d", pick.path === "" ? "." : pick.path);
    } else {
      url.searchParams.append("f", pick.path);
    }
  }
  return url.toString();
}

export function shareUrlSearch(href: string, state: ShareState): string {
  return new URL(buildShareUrl(href, state)).search;
}
