import { isTimeRange, type TimeRange } from "./timeRange.ts";

export type HistoryPart = {
  value: string;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export type SearchHistoryItem = {
  id: string;
  parts: HistoryPart[];
  timeRange: TimeRange | null;
};

export const SEARCH_HISTORY_KEY = "web-grep.searchHistory.v2";
export const SEARCH_HISTORY_MAX = 20;

function historyKey(item: {
  parts: HistoryPart[];
  timeRange: TimeRange | null;
}): string {
  return JSON.stringify({
    parts: item.parts,
    timeRange: item.timeRange,
  });
}

function asHistoryPart(
  value: unknown,
  fallback: { caseSensitive: boolean; wordMatch: boolean; regex: boolean },
): HistoryPart | null {
  if (typeof value === "string" && value !== "") {
    return { value, ...fallback };
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rec = value as Partial<HistoryPart>;
  if (typeof rec.value !== "string" || rec.value === "") {
    return null;
  }
  return {
    value: rec.value,
    caseSensitive: rec.caseSensitive === true,
    wordMatch: rec.wordMatch === true,
    regex: rec.regex === true,
  };
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
      const rec = row as Partial<SearchHistoryItem> & {
        caseSensitive?: boolean;
        wordMatch?: boolean;
        regex?: boolean;
      };
      if (!Array.isArray(rec.parts) || rec.parts.length === 0) {
        continue;
      }
      const fallback = {
        caseSensitive: rec.caseSensitive === true,
        wordMatch: rec.wordMatch === true,
        regex: rec.regex === true,
      };
      const parts = rec.parts
        .map((item) => asHistoryPart(item, fallback))
        .filter((item): item is HistoryPart => item !== null);
      if (parts.length === 0) {
        continue;
      }
      out.push({
        id: typeof rec.id === "string" ? rec.id : `h${out.length}`,
        parts,
        timeRange: isTimeRange(rec.timeRange) ? rec.timeRange : null,
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
