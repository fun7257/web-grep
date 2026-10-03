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
import {
  DEFAULT_HL_OPTS,
  type HlOpts,
  type HlTermInput,
} from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { useResultExpand } from "../hooks/useResultExpand.ts";
import { pickSticky, type StickyHeader } from "../resultSticky.ts";
import { FileIcon, IconChevron, IconFoldAll, IconUnfoldAll } from "./icons.tsx";
import { ResultHitButton } from "./ResultRow.tsx";

// Header is a fixed 36px row (border included). A hit is one 12.5/1.6 line
// plus 7px padding on each side. Two-line hits are measured, not estimated.
const FILE_ROW = 36;
const LOG_ROW = 34;

function splitPath(path: string): { dir: string; name: string } {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash < 0) {
    return { dir: "", name: path };
  }
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

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
  const scrollState = useRef(0);
  const [stickyH, setStickyH] = useState(FILE_ROW);
  const [swapPath, setSwapPath] = useState<string | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stickyPathRef = useRef<string | null>(null);

  const dirOf = (path: string): "asc" | "desc" => sortDir[path] ?? "asc";

  const structureKey = useMemo(() => {
    const folded = Array.from(collapsed).sort().join("\u0000");
    const sorted = Object.keys(sortDir)
      .sort()
      .map((path) => `${path}\u0001${sortDir[path] ?? ""}`)
      .join("\u0000");
    return `${folded}\u0002${sorted}`;
  }, [collapsed, sortDir]);

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
      const ordered = fileHits
        .slice()
        .sort((a, b) =>
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
    estimateSize: (index) =>
      rows[index]?.kind === "header" ? FILE_ROW : LOG_ROW,
    measureElement: (element) => {
      const inner =
        element.querySelector<HTMLElement>("[data-hit-index]") ??
        element.querySelector<HTMLElement>(".result-group-header") ??
        (element.firstElementChild as HTMLElement | null);
      const height = (inner ?? element).getBoundingClientRect().height;
      const kind = rows[Number(element.getAttribute("data-index"))]?.kind;
      if (height <= 0) {
        return kind === "hit" ? LOG_ROW : FILE_ROW;
      }
      // scrollTop is integer here. A fractional slot drifts by that fraction
      // on every compensated collapse.
      return Math.round(height);
    },
    overscan: 12,
    useFlushSync: false,
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
  // virtual-core reads this field on the instance. An option of the same
  // name is stored and never consulted. resizeItem then compensates from
  // the cached offset; if a newer scrollTop has not been observed yet, that
  // write rewinds the jump. Skip only that stale case and keep the library's
  // usual above-the-fold correction, which is what keeps a fast scroll stable.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item,
    _delta,
    instance,
  ) => {
    const el = instance.scrollElement;
    if (el instanceof HTMLElement) {
      const live = instance.options.horizontal ? el.scrollLeft : el.scrollTop;
      const cached = instance.scrollOffset ?? live;
      if (Math.abs(live - cached) > 1) {
        return false;
      }
    }
    const cache = instance as unknown as {
      getScrollOffset(): number;
      scrollAdjustments: number;
    };
    const offset = cache.getScrollOffset() + cache.scrollAdjustments;
    if (!instance.itemSizeCache.has(item.key)) {
      return item.start < offset;
    }
    return (
      item.start + item.size <= offset &&
      instance.scrollDirection !== "backward"
    );
  };

  const {
    openIndexes,
    holdHeights,
    reportTruncation,
    settleStructurePin,
    prepareStructurePin,
  } = useResultExpand({
    listRef,
    virtualizer,
    hits,
    selectedIndex,
    structureKey,
    hitVirtualIndex: (hitIndex) =>
      rows.findIndex((row) => row.kind === "hit" && row.index === hitIndex),
    commitScrollTop: (top) => {
      if (top === scrollState.current) {
        return false;
      }
      scrollState.current = top;
      setScrollTop(top);
      return true;
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
      root.style.setProperty("--sticky-h", `${stickyH}px`);
    };
    const onScroll = (): void => {
      // Motion writes scrollTop itself and publishes the value later.
      if (root.dataset.motionPin === "1") {
        return;
      }
      const next = root.scrollTop;
      if (next === scrollState.current) {
        return;
      }
      scrollState.current = next;
      setScrollTop(next);
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
      // A switch writes scrollTop, then must not read geometry again.
      const scroller = listRef.current;
      if (scroller !== null && scroller.dataset.motionPin === "1") {
        return;
      }
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
  }, [listRef, sticky?.path, sticky?.count, stickyH]);

  useLayoutEffect(() => {
    const path = sticky?.path ?? null;
    const prev = stickyPathRef.current;
    if (
      path !== null &&
      prev !== null &&
      path !== prev &&
      sticky?.pushing !== true
    ) {
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

  useEffect(() => {
    settleStructurePin();
  }, [settleStructurePin, structureKey]);

  const allCollapsed =
    groups.length > 0 && groups.every((group) => collapsed.has(group.path));

  const toggleGroup = (path: string): void => {
    prepareStructurePin();
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
    prepareStructurePin();
    if (allCollapsed) {
      setCollapsed(new Set());
      return;
    }
    setCollapsed(new Set(groups.map((group) => group.path)));
  };

  const sortGroup = (path: string): void => {
    prepareStructurePin();
    const next = dirOf(path) === "asc" ? "desc" : "asc";
    const group = groups.find((item) => item.path === path);
    const ordered = (group?.hits ?? [])
      .slice()
      .sort((a, b) =>
        next === "asc" ? a.hit.line - b.hit.line : b.hit.line - a.hit.line,
      );
    setSortDir((prev) => ({ ...prev, [path]: next }));
    if (ordered[0] !== undefined) {
      onSelect(ordered[0].originalIndex);
    }
  };

  const foldLabel = allCollapsed
    ? t("resultExpandAll")
    : t("resultCollapseAll");
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
      {headActions !== null
        ? createPortal(foldButton, headActions)
        : foldButton}
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
      <div
        ref={listRef}
        className="result-list-scroll"
        role="list"
        tabIndex={0}
      >
        <div
          className="result-list-inner"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            const hold =
              row.kind === "hit"
                ? holdHeights.find((itemHold) => itemHold.index === row.index)
                : undefined;
            return (
              <div
                key={item.key}
                data-index={item.index}
                data-row-key={String(item.key)}
                ref={virtualizer.measureElement}
                className={[
                  "result-virtual-row",
                  row.kind === "header" ? "is-header" : "",
                  hold !== undefined ? "anim" : "",
                ]
                  .filter((name) => name !== "")
                  .join(" ")}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <div className="result-row-motion">
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
                    <ResultHitButton
                      hit={row.hit}
                      index={row.index}
                      selected={row.index === selectedIndex}
                      open={openIndexes.has(row.index)}
                      holdHeight={hold?.height ?? null}
                      terms={terms}
                      opts={opts}
                      onSelect={onSelect}
                      onTruncation={reportTruncation}
                    />
                  )}
                </div>
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
  const parts = splitPath(path);
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
        <span className="result-group-path">
          {parts.dir !== "" ? (
            <span className="result-group-dir">{parts.dir}</span>
          ) : null}
          <span className="result-group-name">{parts.name}</span>
        </span>
      </button>
      <span className="result-group-badge">{count}</span>
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
