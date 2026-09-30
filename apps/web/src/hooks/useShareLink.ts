import type { SseHit } from "@web-grep/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseShareSearch,
  type ShareState,
  shareUrlSearch,
} from "../searchShare.ts";
import type { SearchStatus } from "../state/searchReducer.ts";

type PendingSelect = { path: string; line: number };

export type ShareLink = {
  /** Hit the share link asked to select, while it is still being waited for. */
  sharePending: PendingSelect | null;
  /** Forget any hit the share link was waiting for. */
  dropPendingSelect: () => void;
};

/**
 * Two-way link between the URL and the search UI: restore the draft from
 * `?q=…` once the session is ready, keep the query string in step with the
 * current state, and pick the shared hit when it shows up in the stream.
 */
export function useShareLink(opts: {
  /** True once the meta is loaded and no login or host prompt is in the way. */
  ready: boolean;
  /** Apply the parsed link to the search UI (draft, scope, time range). */
  onRestore: (parsed: ShareState) => void;
  /** The state to mirror into the URL; null when there is nothing to share. */
  shareState: ShareState | null;
  hits: SseHit[];
  status: SearchStatus;
  onSelectIndex: (index: number) => void;
}): ShareLink {
  const { ready, onRestore, shareState, hits, status, onSelectIndex } = opts;
  const [sharePending, setSharePending] = useState<PendingSelect | null>(null);
  const bootstrapped = useRef(false);
  const pendingSelect = useRef<PendingSelect | null>(null);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (bootstrapped.current || !ready) {
      return;
    }
    bootstrapped.current = true;
    const parsed = parseShareSearch(window.location.search);
    if (parsed === null) {
      return;
    }
    if (parsed.path !== undefined && parsed.line !== undefined) {
      pendingSelect.current = { path: parsed.path, line: parsed.line };
    }
    onRestoreRef.current(parsed);
  }, [ready]);

  useEffect(() => {
    if (!bootstrapped.current || shareState === null) {
      return;
    }
    const next = shareUrlSearch(window.location.href, shareState);
    if (window.location.search !== next) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${next}`,
      );
    }
  }, [shareState]);

  useEffect(() => {
    const target = pendingSelect.current;
    if (target === null || hits.length === 0) {
      return;
    }
    const idx = hits.findIndex(
      (hit) => hit.path === target.path && hit.line === target.line,
    );
    if (idx >= 0) {
      onSelectIndex(idx);
      setSharePending(null);
    }
    if (status === "done" || status === "error") {
      pendingSelect.current = null;
      setSharePending(null);
    }
  }, [hits, onSelectIndex, status]);

  const dropPendingSelect = useCallback(() => {
    pendingSelect.current = null;
    setSharePending(null);
  }, []);

  return { sharePending, dropPendingSelect };
}
