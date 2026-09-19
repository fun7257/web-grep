/** Full virtualized /api/file window. This is not FilePreview (right-pane snippet). */
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  parseGotoLine,
  pickGotoLine,
  rangeForLine,
} from "../fileWindow.ts";
import { DEFAULT_HL_OPTS, type HlOpts, type HlTermInput } from "../highlight.ts";
import { useFileWindow } from "../hooks/useFileWindow.ts";
import { useLivePreviewChunk } from "../hooks/useLivePreviewChunk.ts";
import { livePreviewChunkMax } from "../previewChunk.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { AppModal } from "./AppModal.tsx";
import { HighlightedText } from "./ResultRow.tsx";

export const CONTEXT_BEFORE = 30;

const LINE_ROW = 26;

export type ContextTarget = {
  path: string;
  highlightLine?: number;
  matches?: SseHit["matches"];
  allowGotoLine?: boolean;
};

type GotoNotice =
  | { kind: "pastEnd"; requested: number; last: number }
  | { kind: "empty" }
  | { kind: "invalid" };

function lineIsPinned(
  root: HTMLElement,
  row: Element,
  align: "start" | "center" | "end",
): boolean {
  const box = root.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  const slop = 36;
  if (align === "start") {
    return Math.abs(rect.top - box.top) <= slop;
  }
  if (align === "end") {
    if (rect.height >= box.height - slop) {
      return Math.abs(rect.top - box.top) <= slop;
    }
    return Math.abs(rect.bottom - box.bottom) <= slop;
  }
  const mid = (box.top + box.bottom) / 2;
  return rect.top - slop <= mid && rect.bottom + slop >= mid;
}

export function ContextModal({
  open,
  target,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  previewChunk = null,
  onClose,
}: {
  open: boolean;
  target: ContextTarget | null;
  terms?: HlTermInput[];
  opts?: HlOpts;
  previewChunk?: number | null;
  onClose: () => void;
}) {
  const liveChunk = useLivePreviewChunk();
  const chunk = liveChunk ?? previewChunk;
  const chunkReady = chunk != null;
  const { t } = useLocale();
  const path = target?.path ?? null;
  const highlightLine = target?.highlightLine;
  const matches = target?.matches ?? [];
  const allowGotoLine = target?.allowGotoLine === true;
  const listRef = useRef<HTMLDivElement>(null);
  const {
    lines,
    error,
    binary,
    eof,
    loading,
    loadingRef,
    pathRef,
    reset,
    loadSlice,
  } = useFileWindow(t);
  const [focusedLine, setFocusedLine] = useState<number | undefined>(undefined);
  const [gotoDraft, setGotoDraft] = useState("");
  const [gotoNotice, setGotoNotice] = useState<GotoNotice | null>(null);
  const linesRef = useRef(lines);
  const fetchAcRef = useRef<AbortController | null>(null);
  const pendingUp = useRef<{
    prevFirst: number;
    scrollTop: number;
  } | null>(null);
  const focusReq = useRef<number | null>(null);
  const focusAlign = useRef<"start" | "center" | "end">("start");
  const focusTries = useRef(0);
  const [focusTick, setFocusTick] = useState(0);
  pathRef.current = path;
  linesRef.current = lines;

  const replaceSignal = (): AbortSignal => {
    fetchAcRef.current?.abort();
    const ac = new AbortController();
    fetchAcRef.current = ac;
    return ac.signal;
  };

  const activeSignal = (): AbortSignal => {
    if (fetchAcRef.current === null || fetchAcRef.current.signal.aborted) {
      fetchAcRef.current = new AbortController();
    }
    return fetchAcRef.current.signal;
  };

  useEffect(() => {
    if (!open || path === null) {
      reset();
      setFocusedLine(undefined);
      setGotoDraft("");
      setGotoNotice(null);
      loadingRef.current = false;
      focusReq.current = null;
      focusTries.current = 0;
      pendingUp.current = null;
      fetchAcRef.current?.abort();
      fetchAcRef.current = null;
      return;
    }
    if (!chunkReady) {
      return;
    }
    const signal = replaceSignal();
    const around =
      highlightLine !== undefined
        ? rangeForLine(highlightLine, chunk, livePreviewChunkMax())
        : { from: 1, count: chunk };
    setFocusedLine(highlightLine);
    setGotoDraft("");
    setGotoNotice(null);
    focusReq.current = highlightLine ?? null;
    focusAlign.current = "start";
    void loadSlice(
      { path, from: around.from, count: around.count },
      { mode: "replace", signal },
    );
    return () => {
      fetchAcRef.current?.abort();
    };
  }, [
    allowGotoLine,
    highlightLine,
    loadSlice,
    loadingRef,
    open,
    path,
    chunk,
    chunkReady,
    liveChunk,
    previewChunk,
    reset,
  ]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => LINE_ROW,
    overscan: 16,
    initialRect: { width: 800, height: 600 },
    getItemKey: (index) => lines[index]?.n ?? index,
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height;
      return height > 0 ? height : LINE_ROW;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (
      !open ||
      path === null ||
      !chunkReady ||
      loadingRef.current ||
      lines.length === 0
    ) {
      return;
    }
    const first = virtualItems[0];
    const last = virtualItems[virtualItems.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const firstN = lines[0]?.n ?? 1;
    const lastN = lines[lines.length - 1]?.n ?? 1;
    if (
      focusReq.current === null &&
      firstN > 1 &&
      first.index <= 8 &&
      pendingUp.current === null
    ) {
      const from = Math.max(1, firstN - chunk);
      if (from < firstN) {
        pendingUp.current = {
          prevFirst: firstN,
          scrollTop: listRef.current?.scrollTop ?? 0,
        };
        void loadSlice(
          { path, from, count: firstN - from },
          { mode: "merge", dir: "up", signal: activeSignal() },
        ).then((next) => {
          const pending = pendingUp.current;
          if (pending === null) {
            return;
          }
          const first = next?.[0]?.n ?? pending.prevFirst;
          if (next === null || first >= pending.prevFirst) {
            pendingUp.current = null;
          }
        });
      }
    } else if (!eof && last.index >= lines.length - 12) {
      void loadSlice(
        { path, from: lastN + 1, count: chunk },
        { mode: "merge", dir: "down", signal: activeSignal() },
      );
    }
  }, [
    eof,
    lines,
    loadSlice,
    loadingRef,
    open,
    path,
    chunk,
    chunkReady,
    previewChunk,
    virtualItems,
  ]);

  useLayoutEffect(() => {
    const pending = pendingUp.current;
    if (pending === null) {
      return;
    }
    const list = listRef.current;
    if (list === null) {
      pendingUp.current = null;
      return;
    }
    const newFirst = lines[0]?.n ?? pending.prevFirst;
    const added = pending.prevFirst - newFirst;
    if (added <= 0) {
      pendingUp.current = null;
      return;
    }
    list.scrollTop = pending.scrollTop + added * LINE_ROW;
    pendingUp.current = null;
  }, [lines]);

  useLayoutEffect(() => {
    const n = focusReq.current;
    if (n === null || lines.length === 0) {
      return;
    }
    const index = lines.findIndex((line) => line.n === n);
    if (index < 0) {
      return;
    }
    const align = focusAlign.current;
    const root = listRef.current;
    if (pendingUp.current !== null) {
      return;
    }
    if (align === "start" && index === 0 && root !== null) {
      root.scrollTop = 0;
      virtualizer.scrollToOffset(0);
    } else {
      virtualizer.scrollToIndex(index, { align });
    }
    const current =
      root === null ? null : root.querySelector(".preview-line.current");
    if (root !== null && current !== null && lineIsPinned(root, current, align)) {
      focusReq.current = null;
      focusTries.current = 0;
      return;
    }
    focusTries.current += 1;
    if (focusTries.current > 24) {
      focusReq.current = null;
      focusTries.current = 0;
    }
  }, [allowGotoLine, focusTick, focusedLine, lines, virtualItems, virtualizer]);

  useEffect(() => {
    if (!open || path === null) {
      return;
    }
    const el = listRef.current;
    if (el === null) {
      return;
    }
    const pageEarlier = (): void => {
      const firstN = linesRef.current[0]?.n ?? 1;
      if (
        firstN <= 1 ||
        loadingRef.current ||
        !chunkReady ||
        focusReq.current !== null
      ) {
        return;
      }
      const from = Math.max(1, firstN - chunk);
      if (from >= firstN) {
        return;
      }
      pendingUp.current = { prevFirst: firstN, scrollTop: el.scrollTop };
      void loadSlice(
        { path, from, count: firstN - from },
        { mode: "merge", dir: "up", signal: activeSignal() },
      ).then((next) => {
        const pending = pendingUp.current;
        if (pending === null) {
          return;
        }
        const first = next?.[0]?.n ?? pending.prevFirst;
        if (next === null || first >= pending.prevFirst) {
          pendingUp.current = null;
        }
      });
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0 && el.scrollTop <= 0) {
        pageEarlier();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [chunk, chunkReady, lines.length, loadSlice, loadingRef, open, path]);

  const jumpToLine = (requested: number): void => {
    if (path === null || !chunkReady) {
      return;
    }
    if (lines.length === 0 && !loading && !binary) {
      setGotoNotice({ kind: "empty" });
      return;
    }
    pendingUp.current = null;
    const openedPath = path;
    const signal = replaceSignal();
    void (async () => {
      const around = rangeForLine(
        requested,
        chunk,
        livePreviewChunkMax(),
      );
      let next = await loadSlice(
        { path, from: around.from, count: around.count },
        { mode: "replace", signal },
      );
      if (pathRef.current !== openedPath || signal.aborted) {
        return;
      }
      if (next === null) {
        return;
      }
      const exact = next.some((line) => line.n === requested);
      const lastLoaded = next[next.length - 1];
      const pastEof =
        !exact &&
        (next.length === 0 ||
          (lastLoaded !== undefined && lastLoaded.n < requested));
      if (pastEof) {
        next = await loadSlice(
          { path, tail: true, count: chunk },
          { mode: "replace", signal },
        );
        if (pathRef.current !== openedPath || signal.aborted || next === null) {
          return;
        }
      }
      const chosen = pickGotoLine(next, requested);
      if (chosen === null) {
        setFocusedLine(undefined);
        setGotoNotice({ kind: "empty" });
        return;
      }
      setFocusedLine(chosen);
      setGotoDraft(String(chosen));
      focusReq.current = chosen;
      focusTries.current = 0;
      if (chosen === requested) {
        focusAlign.current = "start";
        setGotoNotice(null);
      } else {
        focusAlign.current = "end";
        setGotoNotice({
          kind: "pastEnd",
          requested,
          last: chosen,
        });
      }
      setFocusTick((tick) => tick + 1);
    })();
  };

  const titleLine =
    focusedLine !== undefined ? `:${focusedLine}` : "";
  const fileEmpty =
    !loading && error === null && !binary && lines.length === 0;
  const noticeText =
    gotoNotice === null
      ? null
      : gotoNotice.kind === "pastEnd"
        ? t("previewGotoPastEnd", {
            n: gotoNotice.requested,
            last: gotoNotice.last,
          })
        : gotoNotice.kind === "empty"
          ? t("previewGotoNoLines")
          : t("previewGotoInvalid");

  return (
    <AppModal
      open={open && target !== null}
      title={
        <>
          {target?.path}
          {titleLine !== "" ? (
            <span className="preview-path-line">{titleLine}</span>
          ) : null}
        </>
      }
      ariaLabel={t("previewContext")}
      boxClass="context-modal"
      onClose={onClose}
      headerExtra={
        allowGotoLine ? (
          <form
            className="context-goto"
            onSubmit={(event) => {
              event.preventDefault();
              const n = parseGotoLine(gotoDraft);
              if (n === null) {
                setGotoNotice({ kind: "invalid" });
                return;
              }
              jumpToLine(n);
            }}
          >
            <label className="context-goto-label" htmlFor="context-goto-line">
              {t("previewGotoLine")}
            </label>
            <input
              id="context-goto-line"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={gotoDraft}
              disabled={fileEmpty}
              aria-invalid={gotoNotice !== null}
              aria-label={t("previewGotoLine")}
              {...(noticeText !== null
                ? { "aria-describedby": "context-goto-notice" }
                : {})}
              onChange={(event) => {
                setGotoDraft(event.target.value);
                if (gotoNotice?.kind === "invalid") {
                  setGotoNotice(null);
                }
              }}
            />
            <button
              type="submit"
              className="context-goto-go"
              disabled={fileEmpty}
            >
              {t("previewGotoLineGo")}
            </button>
          </form>
        ) : null
      }
    >
      {noticeText !== null ? (
        <p id="context-goto-notice" className="context-notice" role="status">
          {noticeText}
        </p>
      ) : null}
      {error !== null ? (
        <p className="context-status">{error}</p>
      ) : binary ? (
        <p className="context-status">{t("previewBinary")}</p>
      ) : lines.length === 0 && (loading || (open && !chunkReady)) ? (
        <p className="context-status">{t("loading")}</p>
      ) : lines.length === 0 ? (
        <p className="context-empty">{t("previewFileEmpty")}</p>
      ) : (
        <div ref={listRef} className="context-lines">
          <div
            className="context-lines-inner"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((item) => {
              const line = lines[item.index];
              if (line === undefined) {
                return null;
              }
              const current = focusedLine === line.n;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="context-virtual-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className={
                      current ? "preview-line current" : "preview-line"
                    }
                    {...(current
                      ? { "aria-current": "location" as const }
                      : {})}
                  >
                    <span className="preview-n">{line.n}</span>
                    <span className="preview-text">
                      <HighlightedText
                        text={line.text}
                        terms={terms}
                        opts={opts}
                        matches={current ? matches : []}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppModal>
  );
}
