import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import {
  memo,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { DEFAULT_HL_OPTS, type HlOpts, type HlTermInput } from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { pickSticky, type StickyHeader } from "../resultSticky.ts";
import { FileIcon, IconChevron, IconFoldAll, IconUnfoldAll } from "./icons.tsx";
import { LogLineText } from "./ResultRow.tsx";

const FILE_ROW = 40;
const LOG_ROW = 72;

type Group = {
  path: string;
  hits: Array<{ hit: SseHit; originalIndex: number }>;
};

type VRow =
  | { kind: "header"; path: string; count: number }
  | { kind: "hit"; hit: SseHit; index: number };

export const ResultList = memo(function ResultList({
  hits,
  selectedIndex,
  onSelect,
  listRef,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  headActions = null,
}: {
  hits: SseHit[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  listRef: RefObject<HTMLDivElement | null>;
  terms?: HlTermInput[];
  opts?: HlOpts;
  headActions?: HTMLDivElement | null;
}) {
  const { t } = useLocale();
  const [sortDir, setSortDir] = useState<Record<string, "asc" | "desc">>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [stickyH, setStickyH] = useState(FILE_ROW);
  const [swapPath, setSwapPath] = useState<string | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stickyPathRef = useRef<string | null>(null);

  const dirOf = (path: string): "asc" | "desc" => sortDir[path] ?? "asc";

  const groups = useMemo((): Group[] => {
    const map = new Map<string, Group["hits"]>();
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (hit === undefined) {
        continue;
      }
      let list = map.get(hit.path);
      if (!list) {
        list = [];
        map.set(hit.path, list);
      }
      list.push({ hit, originalIndex: i });
    }
    return Array.from(map.entries()).map(([path, fileHits]) => {
      const dir = sortDir[path] ?? "asc";
      const ordered = fileHits.slice().sort((a, b) =>
        dir === "asc" ? a.hit.line - b.hit.line : b.hit.line - a.hit.line,
      );
      return { path, hits: ordered };
    });
  }, [hits, sortDir]);

  const rows = useMemo((): VRow[] => {
    const out: VRow[] = [];
    for (const group of groups) {
      out.push({ kind: "header", path: group.path, count: group.hits.length });
      if (collapsed.has(group.path)) {
        continue;
      }
      for (const item of group.hits) {
        out.push({ kind: "hit", hit: item.hit, index: item.originalIndex });
      }
    }
    return out;
  }, [collapsed, groups]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? FILE_ROW : LOG_ROW),
    measureElement: (element) => {
      const inner = element.firstElementChild as HTMLElement | null;
      const height = (inner ?? element).getBoundingClientRect().height;
      if (height <= 0) {
        return FILE_ROW;
      }
      return rows[Number(element.getAttribute("data-index"))]?.kind === "hit"
        ? height + 8
        : height;
    },
    overscan: 12,
    scrollPaddingStart: stickyH,
    initialRect: { width: 800, height: 600 },
    getItemKey: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return index;
      }
      return row.kind === "header" ? `h:${row.path}` : `hit:${row.index}`;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const sticky = useMemo(() => {
    const pin = scrollTop + stickyH;
    const nearby: StickyHeader[] = [];
    for (const item of virtualItems) {
      const row = rows[item.index];
      if (row?.kind === "header") {
        nearby.push({
          index: item.index,
          start: item.start,
          path: row.path,
          count: row.count,
        });
      }
    }
    const atFreeze =
      virtualizer.getVirtualItemForOffset(Math.max(0, pin - 1)) ??
      virtualItems.find((item) => item.start + item.size > pin) ??
      virtualItems[0];
    let settled: { path: string; count: number } | null = null;
    if (atFreeze !== undefined) {
      for (let i = atFreeze.index; i >= 0; i--) {
        const row = rows[i];
        if (row?.kind === "header") {
          settled = { path: row.path, count: row.count };
          break;
        }
      }
    }
    return pickSticky(
      nearby,
      scrollTop,
      stickyH,
      (index) => {
        for (let i = index - 1; i >= 0; i--) {
          const row = rows[i];
          if (row?.kind === "header") {
            return { path: row.path, count: row.count };
          }
        }
        return null;
      },
      settled,
    );
  }, [rows, scrollTop, stickyH, virtualItems, virtualizer]);

  useLayoutEffect(() => {
    const root = listRef.current;
    if (root === null) {
      return;
    }
    const apply = (): void => {
      const linePx = 12.5 * 1.5;
      const lines = Math.max(4, Math.floor(root.clientHeight / 2 / linePx));
      root.style.setProperty("--log-lines", String(lines));
      root.style.setProperty("--sticky-h", `${stickyH}px`);
    };
    const onScroll = (): void => {
      setScrollTop(root.scrollTop);
    };
    apply();
    onScroll();
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [listRef, stickyH]);

  useLayoutEffect(() => {
    const node = stickyRef.current;
    if (node === null) {
      return;
    }
    const apply = (): void => {
      const height = node.getBoundingClientRect().height;
      if (height > 0 && Math.abs(height - stickyH) > 0.5) {
        setStickyH(height);
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [sticky?.path, sticky?.count, stickyH]);

  useLayoutEffect(() => {
    const path = sticky?.path ?? null;
    const prev = stickyPathRef.current;
    if (path !== null && prev !== null && path !== prev && sticky?.pushing !== true) {
      setSwapPath(path);
      const timer = window.setTimeout(() => {
        setSwapPath((current) => (current === path ? null : current));
      }, 420);
      stickyPathRef.current = path;
      return () => {
        window.clearTimeout(timer);
      };
    }
    stickyPathRef.current = path;
    return undefined;
  }, [sticky?.path, sticky?.pushing]);

  useEffect(() => {
    const idx = rows.findIndex(
      (row) => row.kind === "hit" && row.index === selectedIndex,
    );
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [selectedIndex, virtualizer]);

  const allCollapsed =
    groups.length > 0 && groups.every((group) => collapsed.has(group.path));

  const toggleGroup = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = (): void => {
    if (allCollapsed) {
      setCollapsed(new Set());
      return;
    }
    setCollapsed(new Set(groups.map((group) => group.path)));
  };

  const sortGroup = (path: string): void => {
    const next = dirOf(path) === "asc" ? "desc" : "asc";
    const group = groups.find((item) => item.path === path);
    const ordered = (group?.hits ?? []).slice().sort((a, b) =>
      next === "asc" ? a.hit.line - b.hit.line : b.hit.line - a.hit.line,
    );
    setSortDir((prev) => ({ ...prev, [path]: next }));
    if (ordered[0] !== undefined) {
      onSelect(ordered[0].originalIndex);
    }
  };

  const foldLabel = allCollapsed ? t("resultExpandAll") : t("resultCollapseAll");
  const foldButton =
    groups.length === 0 ? null : (
      <button
        type="button"
        className="result-fold-all"
        aria-pressed={allCollapsed}
        aria-label={foldLabel}
        title={foldLabel}
        onClick={toggleAll}
      >
        {allCollapsed ? <IconUnfoldAll /> : <IconFoldAll />}
        <span>{foldLabel}</span>
      </button>
    );

  return (
    <div className="result-list grouped">
      {headActions !== null ? createPortal(foldButton, headActions) : foldButton}
      {sticky !== null ? (
        <div
          ref={stickyRef}
          className={[
            "result-sticky-header",
            sticky.pushing ? "is-pushing" : "",
            swapPath === sticky.path ? "is-swap" : "",
          ]
            .filter((name) => name !== "")
            .join(" ")}
          style={{ transform: `translateY(${sticky.shift}px)` }}
        >
          <div className="result-group-header">
          <GroupHeader
            path={sticky.path}
            count={sticky.count}
            expanded={!collapsed.has(sticky.path)}
            dir={dirOf(sticky.path)}
            onToggle={() => {
              toggleGroup(sticky.path);
            }}
            onSort={() => {
              sortGroup(sticky.path);
            }}
            t={t}
          />
          </div>
        </div>
      ) : null}
      <div ref={listRef} className="result-list-scroll" role="list" tabIndex={0}>
        <div
          className="result-list-inner"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={
                  row.kind === "header"
                    ? "result-virtual-row is-header"
                    : "result-virtual-row"
                }
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === "header" ? (
                  <div
                    className={
                      item.start <= scrollTop
                        ? "result-group-header is-stuck"
                        : item.index === sticky?.enteringIndex
                          ? "result-group-header is-entering"
                          : "result-group-header"
                    }
                  >
                    <GroupHeader
                      path={row.path}
                      count={row.count}
                      expanded={!collapsed.has(row.path)}
                      dir={dirOf(row.path)}
                      onToggle={() => {
                        toggleGroup(row.path);
                      }}
                      onSort={() => {
                        sortGroup(row.path);
                      }}
                      t={t}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    role="listitem"
                    className={
                      row.index === selectedIndex
                        ? "result-log selected"
                        : "result-log"
                    }
                    aria-current={row.index === selectedIndex ? "true" : undefined}
                    onClick={() => {
                      onSelect(row.index);
                    }}
                  >
                    <span className="result-loc" style={{ display: "none" }}>
                      {`${row.hit.path}:${row.hit.line}`}
                    </span>
                    <span className="result-line-pill">{row.hit.line}</span>
                    <LogLineText
                      text={row.hit.text}
                      matches={row.hit.matches}
                      terms={terms}
                      opts={opts}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

function GroupHeader({
  path,
  count,
  expanded,
  dir,
  onToggle,
  onSort,
  t,
}: {
  path: string;
  count: number;
  expanded: boolean;
  dir: "asc" | "desc";
  onToggle: () => void;
  onSort: () => void;
  t: (key: "resultSortAsc" | "resultSortDesc" | "resultSortLine") => string;
}) {
  return (
    <>
      <button
        type="button"
        className="result-group-toggle"
        data-file-path={path}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <IconChevron open={expanded} />
        <FileIcon path={path} />
        <span className="result-group-path">{path}</span>
        <span className="result-group-badge">{count}</span>
      </button>
      <button
        type="button"
        className="result-sort"
        aria-pressed={dir === "desc"}
        aria-label={dir === "asc" ? t("resultSortAsc") : t("resultSortDesc")}
        title={dir === "asc" ? t("resultSortAsc") : t("resultSortDesc")}
        onClick={onSort}
      >
        {t("resultSortLine")}
        <span className="result-sort-dir" aria-hidden="true">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </>
  );
}
