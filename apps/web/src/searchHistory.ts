import { isTimeRange, type TimeRange } from "./timeRange.ts";

export type SearchHistoryItem = {
  id: string;
  parts: string[];
  timeRange: TimeRange | null;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export const SEARCH_HISTORY_KEY = "web-grep.searchHistory.v1";
export const SEARCH_HISTORY_MAX = 20;

function historyKey(item: {
  parts: string[];
  timeRange: TimeRange | null;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
}): string {
  return JSON.stringify({
    parts: item.parts,
    timeRange: item.timeRange,
    caseSensitive: item.caseSensitive,
    wordMatch: item.wordMatch,
    regex: item.regex,
  });
}

export function loadSearchHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (raw === null || raw === "") {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: SearchHistoryItem[] = [];
    for (const row of parsed) {
      if (typeof row !== "object" || row === null) {
        continue;
      }
      const rec = row as Partial<SearchHistoryItem>;
      if (!Array.isArray(rec.parts) || rec.parts.length === 0) {
        continue;
      }
      const parts = rec.parts.filter((p): p is string => typeof p === "string" && p !== "");
      if (parts.length === 0) {
        continue;
      }
      out.push({
        id: typeof rec.id === "string" ? rec.id : `h${out.length}`,
        parts,
        timeRange: isTimeRange(rec.timeRange) ? rec.timeRange : null,
        caseSensitive: rec.caseSensitive === true,
        wordMatch: rec.wordMatch === true,
        regex: rec.regex === true,
      });
    }
    return out.slice(0, SEARCH_HISTORY_MAX);
  } catch {
    return [];
  }
}

export function saveSearchHistory(items: SearchHistoryItem[]): void {
  try {
    localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(items.slice(0, SEARCH_HISTORY_MAX)),
    );
  } catch {
    // ignore
  }
}

export function pushSearchHistory(
  items: SearchHistoryItem[],
  next: Omit<SearchHistoryItem, "id">,
): SearchHistoryItem[] {
  if (next.parts.length === 0) {
    return items;
  }
  const key = historyKey(next);
  const rest = items.filter((item) => historyKey(item) !== key);
  const item: SearchHistoryItem = {
    ...next,
    id: `h${Date.now().toString(36)}`,
  };
  const out = [item, ...rest].slice(0, SEARCH_HISTORY_MAX);
  saveSearchHistory(out);
  return out;
}
