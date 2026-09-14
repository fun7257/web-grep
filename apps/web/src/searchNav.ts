import type { TimeRange } from "./timeRange.ts";

export type SearchNavEntry = {
  parts: string[];
  timeRange: TimeRange | null;
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export const SEARCH_NAV_MAX = 50;

export function sameSearchNav(a: SearchNavEntry, b: SearchNavEntry): boolean {
  return (
    a.timeRange === b.timeRange &&
    a.caseSensitive === b.caseSensitive &&
    a.wordMatch === b.wordMatch &&
    a.regex === b.regex &&
    a.parts.length === b.parts.length &&
    a.parts.every((part, i) => part === b.parts[i])
  );
}

export function pushSearchNav(
  stack: SearchNavEntry[],
  index: number,
  entry: SearchNavEntry,
): { stack: SearchNavEntry[]; index: number } {
  const current = index >= 0 ? stack[index] : undefined;
  if (current !== undefined && sameSearchNav(current, entry)) {
    return { stack, index };
  }
  const next = [...stack.slice(0, index + 1), entry];
  const trimmed =
    next.length > SEARCH_NAV_MAX ? next.slice(next.length - SEARCH_NAV_MAX) : next;
  return { stack: trimmed, index: trimmed.length - 1 };
}
