import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocale } from "../hooks/useLocale.ts";
import {
  clearFindPaint,
  findTextRanges,
  paintFindRanges,
  wrapIndex,
} from "../previewFind.ts";
import { IconSearch } from "./icons.tsx";

export function PreviewFindBar({
  rootRef,
  contentKey,
}: {
  rootRef: RefObject<HTMLElement | null>;
  contentKey: string;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wordMatch, setWordMatch] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const root = rootRef.current;
      if (root === null) {
        return;
      }
      const host = root.closest(".preview-pane") ?? root;
      const inRoot =
        event.target instanceof Node &&
        (host.contains(event.target) ||
          inputRef.current?.contains(event.target) === true);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (!inRoot && document.activeElement !== root) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        window.setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        clearFindPaint();
        root.focus?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, rootRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || root === null || query === "") {
      clearFindPaint();
      setCount(0);
      return;
    }
    const ranges = findTextRanges(root, query, {
      caseSensitive,
      wordMatch,
    });
    setCount(ranges.length);
    const current =
      ranges.length === 0 ? 0 : Math.min(index, ranges.length - 1);
    paintFindRanges(ranges, current);
    const active = ranges[current];
    if (active !== undefined && active.startContainer instanceof Node) {
      const el =
        active.startContainer instanceof Element
          ? active.startContainer
          : active.startContainer.parentElement;
      el?.scrollIntoView({ block: "nearest" });
    }
    return () => {
      clearFindPaint();
    };
  }, [caseSensitive, contentKey, index, open, query, rootRef, wordMatch]);

  const move = (delta: number): void => {
    if (count === 0) {
      return;
    }
    setIndex((current) => wrapIndex(current, count, delta));
  };

  return (
    <div className="preview-find">
      <button
        type="button"
        className={open ? "preview-icon-btn is-copied" : "preview-icon-btn"}
        title={`${t("previewFind")} (⌘F)`}
        aria-label={t("previewFind")}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => {
            if (current) {
              clearFindPaint();
              return false;
            }
            return true;
          });
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <IconSearch />
      </button>
      {open ? (
        <div className="preview-find-pop" role="search">
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder={t("previewFindPlaceholder")}
            aria-label={t("previewFind")}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.altKey && (event.key === "c" || event.key === "C")) {
                event.preventDefault();
                setCaseSensitive((value) => !value);
                setIndex(0);
                return;
              }
              if (event.altKey && (event.key === "w" || event.key === "W")) {
                event.preventDefault();
                setWordMatch((value) => !value);
                setIndex(0);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                move(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <button
            type="button"
            className={caseSensitive ? "mod-btn active" : "mod-btn"}
            title={t("caseSensitive")}
            aria-pressed={caseSensitive}
            onClick={() => {
              setCaseSensitive((value) => !value);
              setIndex(0);
            }}
          >
            Aa
          </button>
          <button
            type="button"
            className={wordMatch ? "mod-btn active" : "mod-btn"}
            title={t("wordMatch")}
            aria-pressed={wordMatch}
            onClick={() => {
              setWordMatch((value) => !value);
              setIndex(0);
            }}
          >
            \b
          </button>
          {query !== "" ? (
            <span className="preview-find-count">
              {count === 0 ? t("previewFindNone") : `${index + 1}/${count}`}
            </span>
          ) : null}
          <div className="preview-find-nav">
            <button
              type="button"
              className="preview-icon-btn"
              title={t("previewFindPrev")}
              aria-label={t("previewFindPrev")}
              onClick={() => {
                move(-1);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="preview-icon-btn"
              title={t("previewFindNext")}
              aria-label={t("previewFindNext")}
              onClick={() => {
                move(1);
              }}
            >
              ↓
            </button>
          </div>
          <button
            type="button"
            className="hotkey-close"
            aria-label={t("close")}
            onClick={() => {
              setOpen(false);
              clearFindPaint();
            }}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
