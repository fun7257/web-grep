import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import { memo, type RefObject, useEffect, useMemo, useState } from "react";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";
import { FileIcon, IconChevron } from "./icons.tsx";
import { HighlightedText, ResultRow } from "./ResultRow.tsx";

const FLAT_ROW = 64;
const GROUP_HEADER = 34;
const GROUP_HIT = 40;

type Group = {
  path: string;
  hits: Array<{ hit: SseHit; originalIndex: number }>;
};

type VRow =
  | { kind: "header"; path: string; count: number }
  | { kind: "hit"; hit: SseHit; index: number };

const GroupedHitRow = memo(function GroupedHitRow({
  hit,
  selected,
  index,
  onSelect,
  terms,
  opts,
}: {
  hit: SseHit;
  selected: boolean;
  index: number;
  onSelect: (index: number) => void;
  terms: string[];
  opts: HlOpts;
}) {
  const slash = hit.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : hit.path.slice(0, slash + 1);
  const file = slash === -1 ? hit.path : hit.path.slice(slash + 1);
  return (
    <button
      type="button"
      role="listitem"
      className={
        selected ? "result-row grouped selected" : "result-row grouped"
      }
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        onSelect(index);
      }}
    >
      <span className="result-loc" style={{ display: "none" }}>
        <span className="result-dir">{dir}</span>
        <span className="result-file">{file}</span>
        <span className="result-line">{`:${hit.line}`}</span>
      </span>
      <span className="result-line-pill">{hit.line}</span>
      <span className="result-text">
        <HighlightedText
          text={hit.text}
          matches={hit.matches}
          terms={terms}
          opts={opts}
        />
      </span>
    </button>
  );
});

export const ResultList = memo(function ResultList({
  hits,
  selectedIndex,
  onSelect,
  listRef,
  viewMode = "grouped",
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  hits: SseHit[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  listRef: RefObject<HTMLDivElement | null>;
  viewMode?: "grouped" | "flat";
  terms?: string[];
  opts?: HlOpts;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    return Array.from(map.entries()).map(([path, fileHits]) => ({
      path,
      hits: fileHits,
    }));
  }, [hits]);

  const rows = useMemo((): VRow[] => {
    if (viewMode === "flat") {
      return hits.map((hit, index) => ({ kind: "hit", hit, index }));
    }
    const out: VRow[] = [];
    for (const group of groups) {
      out.push({
        kind: "header",
        path: group.path,
        count: group.hits.length,
      });
      if (collapsed.has(group.path)) {
        continue;
      }
      for (const item of group.hits) {
        out.push({ kind: "hit", hit: item.hit, index: item.originalIndex });
      }
    }
    return out;
  }, [collapsed, groups, hits, viewMode]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row?.kind === "header") {
        return GROUP_HEADER;
      }
      return viewMode === "flat" ? FLAT_ROW : GROUP_HIT;
    },
    overscan: 12,
    initialRect: { width: 800, height: 600 },
    getItemKey: (index) => {
      const row = rows[index];
      if (row === undefined) {
        return index;
      }
      if (row.kind === "header") {
        return `h:${row.path}`;
      }
      return `hit:${row.index}`;
    },
  });

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }
    const idx = rows.findIndex(
      (row) => row.kind === "hit" && row.index === selectedIndex,
    );
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [rows, selectedIndex, virtualizer]);

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

  return (
    <div
      ref={listRef}
      className={viewMode === "grouped" ? "result-list grouped" : "result-list"}
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
          return (
            <div
              key={item.key}
              className="result-virtual-row"
              style={{
                height: `${item.size}px`,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.kind === "header" ? (
                <button
                  type="button"
                  className="result-group-header"
                  onClick={() => {
                    toggleGroup(row.path);
                  }}
                >
                  <IconChevron open={!collapsed.has(row.path)} />
                  <FileIcon path={row.path} />
                  <span className="result-group-path">{row.path}</span>
                  <span className="result-group-badge">{row.count}</span>
                </button>
              ) : viewMode === "flat" ? (
                <ResultRow
                  hit={row.hit}
                  selected={row.index === selectedIndex}
                  index={row.index}
                  onSelect={onSelect}
                  terms={terms}
                  opts={opts}
                />
              ) : (
                <GroupedHitRow
                  hit={row.hit}
                  selected={row.index === selectedIndex}
                  index={row.index}
                  onSelect={onSelect}
                  terms={terms}
                  opts={opts}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
