import { useCallback, useRef, useState } from "react";
import {
  loadSearchHistory,
  pushSearchHistory,
  type SearchHistoryItem,
} from "../searchHistory.ts";
import { pushSearchNav, type SearchNavEntry } from "../searchNav.ts";

export type SearchTrail = {
  history: SearchHistoryItem[];
  canGoBack: boolean;
  canGoForward: boolean;
  /** Log a search that just ran. A step replay is not pushed onto the nav stack. */
  record: (entry: SearchNavEntry) => void;
  /** Move the nav cursor and return the entry to replay, or null at either end. */
  step: (delta: -1 | 1) => SearchNavEntry | null;
};

/** Back/forward stack and recent-search history for the search bar. */
export function useSearchTrail(): SearchTrail {
  const [history, setHistory] = useState(loadSearchHistory);
  const [nav, setNav] = useState<{ stack: SearchNavEntry[]; index: number }>({
    stack: [],
    index: -1,
  });
  const skipNavRef = useRef(false);

  const record = useCallback((entry: SearchNavEntry) => {
    if (!skipNavRef.current) {
      setNav((cur) => pushSearchNav(cur.stack, cur.index, entry));
    }
    skipNavRef.current = false;
    setHistory((prev) => pushSearchHistory(prev, entry));
  }, []);

  const step = useCallback(
    (delta: -1 | 1): SearchNavEntry | null => {
      if (nav.index < 0) {
        return null;
      }
      const nextIndex = nav.index + delta;
      const entry = nav.stack[nextIndex];
      if (entry === undefined) {
        return null;
      }
      setNav((cur) => ({ ...cur, index: nextIndex }));
      skipNavRef.current = true;
      return entry;
    },
    [nav],
  );

  return {
    history,
    canGoBack: nav.index > 0,
    canGoForward: nav.index >= 0 && nav.index < nav.stack.length - 1,
    record,
    step,
  };
}
