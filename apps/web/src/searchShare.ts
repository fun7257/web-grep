import { isTimeRange, type TimeRange } from "./timeRange.ts";

export type ShareState = {
  parts: string[];
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
  path?: string;
  line?: number;
  timeRange?: TimeRange;
};

export function parseShareSearch(search: string): ShareState | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (raw === "") {
    return null;
  }
  const params = new URLSearchParams(raw);
  const parts = params
    .getAll("q")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const path = params.get("p")?.trim() ?? "";
  const lineRaw = params.get("n");
  const line =
    lineRaw !== null && lineRaw !== "" ? Number(lineRaw) : Number.NaN;
  const timeRaw = params.get("t");
  return {
    parts,
    caseSensitive: params.get("s") === "1",
    wordMatch: params.get("w") === "1",
    regex: params.get("r") === "1",
    ...(path !== "" ? { path } : {}),
    ...(Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(isTimeRange(timeRaw) ? { timeRange: timeRaw } : {}),
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
  return url.toString();
}
