import { useCallback, useEffect, useState } from "react";

const TREE_WIDTH_KEY = "web-grep.treeWidth.v2";
const HITS_WIDTH_KEY = "web-grep.hitsWidth.v1";

const DEFAULT_TREE_WIDTH = 215;
const DEFAULT_HITS_WIDTH = 560;
const TREE_MIN = 215;
const TREE_MAX = 520;
const HITS_MIN = 560;
const HITS_MAX = 900;
const PREVIEW_MIN = 260;
const SPLITTER = 6;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function useResizablePanes() {
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const saved = localStorage.getItem(TREE_WIDTH_KEY);
    return saved ? clamp(Number(saved), TREE_MIN, TREE_MAX) : DEFAULT_TREE_WIDTH;
  });

  const [hitsWidth, setHitsWidth] = useState<number>(() => {
    const saved = localStorage.getItem(HITS_WIDTH_KEY);
    return saved ? clamp(Number(saved), HITS_MIN, HITS_MAX) : DEFAULT_HITS_WIDTH;
  });

  const [resizing, setResizing] = useState<"tree" | "hits" | null>(null);

  const startResizeTree = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing("tree");
  }, []);

  const startResizeHits = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing("hits");
  }, []);

  const resetPanes = useCallback(() => {
    setTreeWidth(DEFAULT_TREE_WIDTH);
    setHitsWidth(DEFAULT_HITS_WIDTH);
    localStorage.removeItem(TREE_WIDTH_KEY);
    localStorage.removeItem(HITS_WIDTH_KEY);
  }, []);

  useEffect(() => {
    if (resizing === null) {
      return;
    }

    const onMouseMove = (e: MouseEvent) => {
      if (resizing === "tree") {
        const next = clamp(e.clientX, TREE_MIN, TREE_MAX);
        setTreeWidth(next);
        localStorage.setItem(TREE_WIDTH_KEY, String(next));
      } else if (resizing === "hits") {
        const treeActual =
          document.querySelector(".tree-pane")?.clientWidth ?? 0;
        const maxHits = Math.max(
          HITS_MIN,
          window.innerWidth - treeActual - SPLITTER * 2 - PREVIEW_MIN,
        );
        const next = clamp(
          e.clientX - treeActual,
          HITS_MIN,
          Math.min(HITS_MAX, maxHits),
        );
        setHitsWidth(next);
        localStorage.setItem(HITS_WIDTH_KEY, String(next));
      }
    };

    const onMouseUp = () => {
      setResizing(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing]);

  return {
    treeWidth,
    hitsWidth,
    resizing,
    startResizeTree,
    startResizeHits,
    resetPanes,
  };
}
