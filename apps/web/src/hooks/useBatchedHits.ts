import type { SseHit } from "@web-grep/shared";
import { useEffect, useRef, useState } from "react";
import type { SearchStatus } from "../state/searchReducer.ts";

/** Coalesce list regrouping while SSE hits are still arriving. */
export const HIT_BATCH_MS = 40;
/** Flush immediately when this many unpublished hits have piled up. */
export const HIT_BATCH_N = 32;

export function isHitsPrefix(published: SseHit[], hits: SseHit[]): boolean {
  const n = published.length;
  if (n === 0) {
    return true;
  }
  if (n > hits.length) {
    return false;
  }
  return published[0] === hits[0] && published[n - 1] === hits[n - 1];
}

export function shouldFlushListHits(
  published: SseHit[],
  hits: SseHit[],
  status: SearchStatus,
): boolean {
  if (status !== "running") {
    return true;
  }
  if (hits.length === 0) {
    return true;
  }
  if (!isHitsPrefix(published, hits)) {
    return true;
  }
  if (published.length === 0) {
    return true;
  }
  return hits.length - published.length >= HIT_BATCH_N;
}

/**
 * Keep accepting hits into the caller’s state, but only publish a list
 * snapshot for grouping/redraw every {@link HIT_BATCH_MS} or {@link HIT_BATCH_N}
 * hits. Terminal status, a reset, and the first paint flush immediately.
 */
export function useBatchedHits(hits: SseHit[], status: SearchStatus): SseHit[] {
  const [published, setPublished] = useState<SseHit[]>(hits);
  const publishedRef = useRef(published);
  const hitsRef = useRef(hits);
  const timerRef = useRef(0);

  publishedRef.current = published;
  hitsRef.current = hits;

  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current !== 0) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
      const next = hitsRef.current;
      if (publishedRef.current !== next) {
        setPublished(next);
      }
    };

    if (shouldFlushListHits(publishedRef.current, hits, status)) {
      flush();
      return;
    }

    if (hits.length === publishedRef.current.length) {
      return;
    }

    if (timerRef.current === 0) {
      timerRef.current = window.setTimeout(flush, HIT_BATCH_MS);
    }
  }, [hits, status]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== 0) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (shouldFlushListHits(published, hits, status)) {
    return hits;
  }
  return published;
}
