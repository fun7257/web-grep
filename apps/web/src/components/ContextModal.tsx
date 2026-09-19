/** Full virtualized /api/file window. This is not FilePreview (right-pane snippet). */
import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PREVIEW_CHUNK } from "../previewChunk.ts";
import {
  parseGotoLine,
  pickGotoLine,
} from "../fileWindow.ts";
import { DEFAULT_HL_OPTS, type HlOpts, type HlTermInput } from "../highlight.ts";
import { useFileWindow } from "../hooks/useFileWindow.ts";
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
  previewChunk = PREVIEW_CHUNK,
  onClose,
}: {
  open: boolean;
  target: ContextTarget | null;
  terms?: HlTermInput[];
  opts?: HlOpts;
  previewChunk?: number;
  onClose: () => void;
}) {
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
  const anchorN = useRef<number | null>(null);
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
      fetchAcRef.current?.abort();
      fetchAcRef.current = null;
      return;
    }
    const signal = replaceSignal();
    const from = highlightLine !== undefined ? highlightLine : 1;
    setFocusedLine(highlightLine);
    setGotoDraft("");
    setGotoNotice(null);
    focusReq.current = highlightLine ?? null;
    focusAlign.current = "start";
    void loadSlice(
      { path, from, count: previewChunk },
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
    if (!open || path === null || loadingRef.current || lines.length === 0) {
      return;
    }
    const first = virtualItems[0];
    const last = virtualItems[virtualItems.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const firstN = lines[0]?.n ?? 1;
    const lastN = lines[lines.length - 1]?.n ?? 1;
    const load = (from: number, dir: "up" | "down"): void => {
      if (dir === "up") {
        const shown = lines[first.index]?.n;
        anchorN.current = shown ?? firstN;
      }
      void loadSlice(
        { path, from, count: previewChunk },
        { mode: "merge", dir, signal: activeSignal() },
      );
    };
    if (!eof && last.index >= lines.length - 12) {
      load(lastN + 1, "down");
    } else if (
      focusedLine === undefined &&
      firstN > 1 &&
      first.index <= 8
    ) {
      load(Math.max(1, firstN - previewChunk), "up");
    }
  }, [
    eof,
    focusedLine,
    lines,
    loadSlice,
    loadingRef,
    open,
    path,
    previewChunk,
    virtualItems,
  ]);

  useLayoutEffect(() => {
    const n = anchorN.current;
    if (n === null) {
      return;
    }
    const index = lines.findIndex((line) => line.n === n);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "start" });
    }
    anchorN.current = null;
  }, [lines, virtualizer]);

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
      if (firstN <= 1 || loadingRef.current) {
        return;
      }
      anchorN.current = firstN;
      void loadSlice(
        { path, from: Math.max(1, firstN - previewChunk), count: previewChunk },
        { mode: "merge", dir: "up", signal: activeSignal() },
      );
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
  }, [lines.length, loadSlice, loadingRef, open, path, previewChunk]);

  const jumpToLine = (requested: number): void => {
    if (path === null) {
      return;
    }
    if (lines.length === 0 && !loading && !binary) {
      setGotoNotice({ kind: "empty" });
      return;
    }
    anchorN.current = null;
    const openedPath = path;
    const signal = replaceSignal();
    void (async () => {
      let next = await loadSlice(
        { path, from: requested, count: previewChunk },
        { mode: "replace", signal },
      );
      if (pathRef.current !== openedPath || signal.aborted) {
        return;
      }
      if (next === null) {
        return;
      }
      const exact = next.some((line) => line.n === requested);
      if (!exact) {
        next = await loadSlice(
          { path, tail: true, count: previewChunk },
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
      if (listRef.current !== null && chosen === requested) {
        listRef.current.scrollTop = 0;
      }
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
      ) : lines.length === 0 && loading ? (
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
