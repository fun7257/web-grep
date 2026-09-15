import { isTimeRange, type TimeRange } from "./timeRange.ts";
import type { TreePick } from "./treePicks.ts";

export type ShareState = {
  parts: string[];
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  path?: string;
  line?: number;
  timeRange?: TimeRange;
  includeGlobs?: string;
  excludeGlobs?: string;
  picks?: TreePick[];
  scope?: "include" | "exclude";
};

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
  fields: string[];
  fallbackParts?: string[];
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  includeGlobs: string;
  excludeGlobs: string;
  picks: TreePick[];
  scope: "all" | "include" | "exclude";
  timeRange: TimeRange | null;
  hitPath?: string;
  hitLine?: number;
}): ShareState | null {
  const parts = trimmedList(input.fields);
  const fallback = trimmedList(input.fallbackParts);
  const query = parts.length > 0 ? parts : fallback;
  if (query.length === 0) {
    return null;
  }
  const includeGlobs = input.includeGlobs.trim();
  const excludeGlobs = input.excludeGlobs.trim();
  const hitPath = input.hitPath?.trim() ?? "";
  const hitLine = input.hitLine ?? 0;
  return {
    parts: query,
    caseSensitive: input.caseSensitive,
    wordMatch: input.wordMatch,
    regex: input.regex,
    ...(hitPath !== "" ? { path: hitPath } : {}),
    ...(Number.isInteger(hitLine) && hitLine > 0 ? { line: hitLine } : {}),
    ...(input.timeRange !== null ? { timeRange: input.timeRange } : {}),
    ...(includeGlobs !== "" ? { includeGlobs } : {}),
    ...(excludeGlobs !== "" ? { excludeGlobs } : {}),
    ...(input.picks.length > 0 ? { picks: input.picks } : {}),
    ...(input.picks.length > 0 && input.scope === "exclude"
      ? { scope: "exclude" as const }
      : {}),
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
  const includeGlobs = joinedParam(params, "i");
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
  return {
    parts,
    caseSensitive: params.get("s") === "1",
    wordMatch: params.get("w") === "1",
    regex: params.get("r") === "1",
    ...(path !== "" ? { path } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(isTimeRange(timeRaw) ? { timeRange: timeRaw } : {}),
    ...(includeGlobs !== "" ? { includeGlobs } : {}),
    ...(excludeGlobs !== "" ? { excludeGlobs } : {}),
    ...(picks.length > 0 ? { picks } : {}),
    ...(params.get("k") === "x" ? { scope: "exclude" as const } : {}),
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
  if (state.caseSensitive) {
    url.searchParams.set("s", "1");
  }
  if (state.wordMatch) {
    url.searchParams.set("w", "1");
  }
  if (state.regex) {
    url.searchParams.set("r", "1");
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
  const includeGlobs = state.includeGlobs?.trim() ?? "";
  if (includeGlobs !== "") {
    url.searchParams.set("i", includeGlobs);
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
  if (state.scope === "exclude") {
    url.searchParams.set("k", "x");
  }
  return url.toString();
}

export function shareUrlSearch(href: string, state: ShareState): string {
  return new URL(buildShareUrl(href, state)).search;
}
