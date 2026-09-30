import type { SearchRequestInput } from "@web-grep/shared";
import { useCallback, useState } from "react";
import { parseGlobs } from "../globs.ts";
import type { SearchNavEntry } from "../searchNav.ts";
import {
  newPart,
  type QueryPart,
  type SearchStack,
  toRequest,
} from "../searchStack.ts";
import { mtimeAfterMs, type TimeRange } from "../timeRange.ts";
import { picksToSearchGlobs, type TreePick } from "../treePicks.ts";
import { useLocale } from "./useLocale.ts";

export function partsFromFields(values: QueryPart[]): QueryPart[] {
  return values
    .map((part) => ({ ...part, value: part.value.trim() }))
    .filter((part) => part.value !== "");
}

export function navEntryOf(
  parts: QueryPart[],
  timeRange: TimeRange | null,
): SearchNavEntry {
  return {
    parts: parts.map((part) => ({
      value: part.value,
      caseSensitive: part.caseSensitive,
      wordMatch: part.wordMatch,
      regex: part.regex,
    })),
    timeRange,
  };
}

export type SearchSession = {
  /** Draft rows in the search bar. */
  fields: QueryPart[];
  setFields: (fields: QueryPart[]) => void;
  /** The stack of the search that was last sent, or null before any search. */
  lastStack: SearchStack | null;
  setLastStack: (
    next:
      | SearchStack
      | null
      | ((cur: SearchStack | null) => SearchStack | null),
  ) => void;
  searchWithParts: (
    nextParts: QueryPart[],
    extraInclude?: string[],
    nextTime?: TimeRange | null,
    nextPicks?: TreePick[],
    nextExcludeRaw?: string,
  ) => void;
  /** Send the draft rows, or repeat the last search when the draft is empty. */
  submit: () => void;
  /** Re-search a text picked in the preview, keeping the head row's modifiers. */
  searchSelected: (text: string) => void;
  /** Drop the draft and the last stack (clear / logout). */
  resetDraft: () => void;
};

/**
 * The query the user is building and the one that was last sent. Scope
 * (time range, tree picks, exclude globs) is owned by the caller.
 */
export function useSearchSession(opts: {
  timeRange: TimeRange | null;
  picks: TreePick[];
  excludeGlobs: string;
  runSearch: (input: SearchRequestInput) => void;
  record: (entry: SearchNavEntry) => void;
  showInfoCue: (message: string) => void;
  /** Called when a new search starts, e.g. to reset the hit selection. */
  onStart: () => void;
  searchLocked: boolean;
}): SearchSession {
  const {
    timeRange,
    picks,
    excludeGlobs,
    runSearch,
    record,
    showInfoCue,
    onStart,
    searchLocked,
  } = opts;
  const { t } = useLocale();
  const [fields, setFields] = useState<QueryPart[]>(() => [newPart("")]);
  const [lastStack, setLastStack] = useState<SearchStack | null>(null);

  const searchWithParts = useCallback(
    (
      nextParts: QueryPart[],
      extraInclude: string[] = [],
      nextTime: TimeRange | null = timeRange,
      nextPicks: TreePick[] = picks,
      nextExcludeRaw: string = excludeGlobs,
    ) => {
      const ready = partsFromFields(nextParts);
      if (ready.length === 0) {
        return;
      }
      const globs = picksToSearchGlobs(
        nextPicks,
        extraInclude,
        parseGlobs(nextExcludeRaw),
      );
      if (globs.blocked) {
        showInfoCue(t("pickTooLong"));
        return;
      }
      if (globs.omitted.length > 0) {
        showInfoCue(t("pickTooLongSkipped", { n: globs.omitted.length }));
      }
      const head = ready[0];

      const stack: SearchStack = {
        parts: ready,
        globInclude: globs.globInclude,
        globIntersect: [],
        globExclude: globs.globExclude,
        path: "",
        caseSensitive: head?.caseSensitive ?? false,
        wordMatch: head?.wordMatch ?? false,
        regex: head?.regex ?? false,
        hidden: true,
      };

      setLastStack(stack);
      setFields(ready);
      onStart();
      record(navEntryOf(ready, nextTime));
      runSearch(
        toRequest(
          stack,
          [],
          nextTime !== null ? mtimeAfterMs(nextTime) : undefined,
        ),
      );
    },
    [
      excludeGlobs,
      onStart,
      picks,
      record,
      runSearch,
      showInfoCue,
      t,
      timeRange,
    ],
  );

  const submit = useCallback(() => {
    if (searchLocked) {
      return;
    }
    const parsed = partsFromFields(fields);
    searchWithParts(parsed.length > 0 ? parsed : (lastStack?.parts ?? []));
  }, [fields, lastStack, searchLocked, searchWithParts]);

  const searchSelected = useCallback(
    (text: string) => {
      if (searchLocked) {
        return;
      }
      const current = fields[0];
      searchWithParts([
        newPart(text, {
          caseSensitive: current?.caseSensitive ?? false,
          wordMatch: current?.wordMatch ?? false,
          regex: current?.regex ?? false,
        }),
      ]);
    },
    [fields, searchLocked, searchWithParts],
  );

  const resetDraft = useCallback(() => {
    setLastStack(null);
    setFields([newPart("")]);
  }, []);

  return {
    fields,
    setFields,
    lastStack,
    setLastStack,
    searchWithParts,
    submit,
    searchSelected,
    resetDraft,
  };
}
