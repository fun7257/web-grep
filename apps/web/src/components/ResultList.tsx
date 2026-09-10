import { useVirtualizer } from "@tanstack/react-virtual";
import type { SseHit } from "@web-grep/shared";
import { useEffect, useRef } from "react";
import { ResultRow } from "./ResultRow.tsx";

const ROW_HEIGHT = 28;

export function ResultList({
  hits,
  selectedIndex,
  onSelect,
}: {
  hits: SseHit[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    initialRect: { width: 800, height: 600 },
  });

  useEffect(() => {
    if (hits.length === 0) {
      return;
    }
    virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [hits.length, selectedIndex, virtualizer]);

  return (
    <div ref={parentRef} className="result-list" role="list">
      <div
        className="result-list-inner"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const hit = hits[row.index];
          if (hit === undefined) {
            return null;
          }
          return (
            <div
              key={row.key}
              className="result-virtual-row"
              style={{
                height: `${row.size}px`,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <ResultRow
                hit={hit}
                selected={row.index === selectedIndex}
                onSelect={() => {
                  onSelect(row.index);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
