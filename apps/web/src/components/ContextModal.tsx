import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchFileWindow, PREVIEW_CHUNK } from "../api/fileClient.ts";
import { SearchHttpError } from "../api/searchClient.ts";
import { DEFAULT_HL_OPTS, type HlOpts, type HlTermInput } from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { HighlightedText } from "./ResultRow.tsx";

export const CONTEXT_BEFORE = 30;

const LINE_ROW = 26;

export type ContextTarget = {
  path: string;
  highlightLine?: number;
  matches?: SseHit["matches"];
  allowGotoLine?: boolean;
};

type WindowLine = { n: number; text: string };

type GotoNotice =
  | { kind: "pastEnd"; requested: number; last: number }
  | { kind: "empty" }
  | { kind: "invalid" };

function mergeLines(current: WindowLine[], incoming: WindowLine[]): WindowLine[] {
  if (incoming.length === 0) {
    return current;
  }
  const byN = new Map<number, WindowLine>();
  for (const line of current) {
    byN.set(line.n, line);
  }
  for (const line of incoming) {
    byN.set(line.n, line);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

function parseGotoLine(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }
  return n;
}

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

function pickGotoLine(lines: WindowLine[], requested: number): number | null {
  if (lines.length === 0) {
    return null;
  }
  const exact = lines.find((line) => line.n === requested);
  if (exact !== undefined) {
    return exact.n;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (last !== undefined && requested > last.n) {
    return last.n;
  }
  if (first !== undefined && requested < first.n) {
    return first.n;
  }
  let best = first ?? last;
  if (best === undefined) {
    return null;
  }
  for (const line of lines) {
    if (Math.abs(line.n - requested) < Math.abs(best.n - requested)) {
      best = line;
    }
  }
  return best.n;
}

export function ContextModal({
  open,
  target,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onClose,
}: {
  open: boolean;
  target: ContextTarget | null;
  terms?: HlTermInput[];
  opts?: HlOpts;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const path = target?.path ?? null;
  const highlightLine = target?.highlightLine;
  const matches = target?.matches ?? [];
  const allowGotoLine = target?.allowGotoLine === true;
  const listRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<WindowLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [eof, setEof] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedLine, setFocusedLine] = useState<number | undefined>(undefined);
  const [gotoDraft, setGotoDraft] = useState("");
  const [gotoNotice, setGotoNotice] = useState<GotoNotice | null>(null);
  const loadingRef = useRef(false);
  const pathRef = useRef(path);
  const linesRef = useRef<WindowLine[]>([]);
  const anchorN = useRef<number | null>(null);
  const focusReq = useRef<number | null>(null);
  const focusAlign = useRef<"start" | "center" | "end">("start");
  const focusTries = useRef(0);
  const [focusTick, setFocusTick] = useState(0);
  pathRef.current = path;
  linesRef.current = lines;

  useEffect(() => {
    if (!open || path === null) {
      setLines([]);
      setError(null);
      setBinary(false);
      setEof(false);
      setLoading(false);
      setFocusedLine(undefined);
      setGotoDraft("");
      setGotoNotice(null);
      loadingRef.current = false;
      focusReq.current = null;
      focusTries.current = 0;
      return;
    }
    const ac = new AbortController();
    const from =
      highlightLine !== undefined
        ? Math.max(1, highlightLine - CONTEXT_BEFORE)
        : 1;
    loadingRef.current = true;
    setLoading(true);
    setLines([]);
    setError(null);
    setBinary(false);
    setEof(false);
    setFocusedLine(highlightLine);
    setGotoDraft("");
    setGotoNotice(null);
    focusReq.current = highlightLine ?? null;
    focusAlign.current = allowGotoLine ? "start" : "center";
    void fetchFileWindow({ path, from, count: PREVIEW_CHUNK }, ac.signal)
      .then((win) => {
        if (win.binary) {
          setBinary(true);
          setLines([]);
          setEof(true);
          return;
        }
        setBinary(false);
        setLines(win.lines);
        setEof(win.eof === true || win.lines.length === 0);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) {
          return;
        }
        setError(
          err instanceof SearchHttpError ? err.body.message : t("searchFailed"),
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          loadingRef.current = false;
          setLoading(false);
        }
      });
    return () => {
      ac.abort();
    };
  }, [allowGotoLine, highlightLine, open, path, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

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
      loadingRef.current = true;
      setLoading(true);
      if (dir === "up") {
        const shown = lines[first.index]?.n;
        anchorN.current = shown ?? firstN;
      }
      const openedPath = path;
      void fetchFileWindow({ path, from, count: PREVIEW_CHUNK })
        .then((win) => {
          if (pathRef.current !== openedPath) {
            return;
          }
          if (win.binary) {
            setBinary(true);
            return;
          }
          setLines((current) => mergeLines(current, win.lines));
          if (dir === "down") {
            const grew = win.lines.some((line) => line.n > lastN);
            if (win.eof === true || !grew) {
              setEof(true);
            }
          }
        })
        .catch((err: unknown) => {
          if (pathRef.current !== openedPath) {
            return;
          }
          setError(
            err instanceof SearchHttpError
              ? err.body.message
              : t("searchFailed"),
          );
        })
        .finally(() => {
          if (pathRef.current === openedPath) {
            loadingRef.current = false;
            setLoading(false);
          }
        });
    };
    if (!eof && last.index >= lines.length - 12) {
      load(lastN + 1, "down");
    } else if (!allowGotoLine && firstN > 1 && first.index <= 8) {
      load(Math.max(1, firstN - PREVIEW_CHUNK), "up");
    }
  }, [allowGotoLine, eof, lines, open, path, t, virtualItems]);

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
    const align = allowGotoLine ? focusAlign.current : "center";
    const root = listRef.current;
    if (align === "start" && index === 0 && root !== null) {
      root.scrollTop = 0;
      virtualizer.scrollToOffset(0);
    } else {
      virtualizer.scrollToIndex(index, { align });
    }
    const current = root?.querySelector(".preview-line.current");
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
    if (!open || !allowGotoLine || path === null) {
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
      loadingRef.current = true;
      setLoading(true);
      const openedPath = path;
      const from = Math.max(1, firstN - PREVIEW_CHUNK);
      void fetchFileWindow({ path, from, count: PREVIEW_CHUNK })
        .then((win) => {
          if (pathRef.current !== openedPath) {
            return;
          }
          if (win.binary) {
            setBinary(true);
            return;
          }
          setLines(win.lines);
          setEof(false);
          setFocusedLine((current) =>
            current !== undefined && win.lines.some((line) => line.n === current)
              ? current
              : undefined,
          );
          if (listRef.current !== null) {
            listRef.current.scrollTop = 0;
          }
        })
        .catch((err: unknown) => {
          if (pathRef.current !== openedPath) {
            return;
          }
          setError(
            err instanceof SearchHttpError
              ? err.body.message
              : t("searchFailed"),
          );
        })
        .finally(() => {
          if (pathRef.current === openedPath) {
            loadingRef.current = false;
            setLoading(false);
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
  }, [allowGotoLine, lines.length, open, path, t]);

  const jumpToLine = (requested: number): void => {
    if (path === null) {
      return;
    }
    if (lines.length === 0 && !loading && !binary) {
      setGotoNotice({ kind: "empty" });
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setGotoNotice(null);
    anchorN.current = null;
    const openedPath = path;
    void (async () => {
      try {
        let win = await fetchFileWindow({
          path,
          from: requested,
          count: PREVIEW_CHUNK,
        });
        if (pathRef.current !== openedPath) {
          return;
        }
        if (win.binary) {
          setBinary(true);
          setLines([]);
          setEof(true);
          return;
        }
        const exact = win.lines.some((line) => line.n === requested);
        if (!exact) {
          win = await fetchFileWindow({
            path,
            tail: true,
            count: PREVIEW_CHUNK,
          });
          if (pathRef.current !== openedPath) {
            return;
          }
        }
        const chosen = pickGotoLine(win.lines, requested);
        setBinary(false);
        setLines(win.lines);
        setEof(win.eof === true || win.lines.length === 0);
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
      } catch (err: unknown) {
        if (pathRef.current !== openedPath) {
          return;
        }
        setError(
          err instanceof SearchHttpError ? err.body.message : t("searchFailed"),
        );
      } finally {
        if (pathRef.current === openedPath) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    })();
  };

  if (!open || target === null) {
    return null;
  }

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
    <div
      className="token-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("previewContext")}
      onClick={onClose}
    >
      <div
        className="context-modal"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="hotkey-header">
          <h2>
            {target.path}
            {titleLine !== "" ? (
              <span className="preview-path-line">{titleLine}</span>
            ) : null}
          </h2>
          {allowGotoLine ? (
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
          ) : null}
          <button
            type="button"
            className="hotkey-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
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
      </div>
    </div>
  );
}
