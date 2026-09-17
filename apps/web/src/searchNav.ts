import type { TimeRange } from "./timeRange.ts";
import type { SearchModifiers } from "./searchStack.ts";

export type NavPart = {
  value: string;
} & SearchModifiers;

export type SearchNavEntry = {
  parts: NavPart[];
  timeRange: TimeRange | null;
};

export const SEARCH_NAV_MAX = 50;

export function sameSearchNav(a: SearchNavEntry, b: SearchNavEntry): boolean {
  return (
    a.timeRange === b.timeRange &&
    a.parts.length === b.parts.length &&
    a.parts.every((part, i) => {
      const other = b.parts[i];
      return (
        other !== undefined &&
        part.value === other.value &&
        part.caseSensitive === other.caseSensitive &&
        part.wordMatch === other.wordMatch &&
        part.regex === other.regex
      );
    })
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
