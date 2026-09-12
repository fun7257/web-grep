import { useCallback, useEffect, useState } from "react";

const TREE_WIDTH_KEY = "web-grep.treeWidth.v1";
const HITS_WIDTH_KEY = "web-grep.hitsWidth.v1";

const DEFAULT_TREE_WIDTH = 280;
const DEFAULT_HITS_WIDTH = 420;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function useResizablePanes() {
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const saved = localStorage.getItem(TREE_WIDTH_KEY);
    return saved ? clamp(Number(saved), 220, 520) : DEFAULT_TREE_WIDTH;
  });

  const [hitsWidth, setHitsWidth] = useState<number>(() => {
    const saved = localStorage.getItem(HITS_WIDTH_KEY);
    return saved ? clamp(Number(saved), 280, 800) : DEFAULT_HITS_WIDTH;
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
        const next = clamp(e.clientX, 220, 520);
        setTreeWidth(next);
        localStorage.setItem(TREE_WIDTH_KEY, String(next));
      } else if (resizing === "hits") {
        const treeActual = document.querySelector(".tree-pane")?.clientWidth ?? 0;
        const next = clamp(e.clientX - treeActual, 280, 800);
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
