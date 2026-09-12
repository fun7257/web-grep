import { useCallback, useEffect, useState } from "react";
import { SearchHttpError } from "../api/searchClient.ts";
import { fetchTree, type TreeEntry } from "../api/treeClient.ts";
import { useLocale } from "../hooks/useLocale.ts";
import type { TreePick } from "../treePicks.ts";
import {
  BrandMark,
  FileIcon,
  IconCheck,
  IconChevron,
  IconMinusCircle,
  IconPanel,
  IconTarget,
  IconX,
} from "./icons.tsx";
import { LocaleToggle } from "./StatusBar.tsx";

const TREE_OPEN_KEY = "web-grep.treeOpen.v2";
export const TREE_RAIL_WIDTH = 56;

function loadOpen(): boolean {
  return localStorage.getItem(TREE_OPEN_KEY) !== "0";
}

type NodeProps = {
  entry: TreeEntry;
  depth: number;
  activePath: string | null;
  pickedPaths: Set<string>;
  onTogglePick: (entry: TreeEntry) => void;
  onAuthFailure?: (err: SearchHttpError) => void;
};

function TreeNode({
  entry,
  depth,
  activePath,
  pickedPaths,
  onTogglePick,
  onAuthFailure,
}: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadKids = useCallback(async () => {
    if (!entry.dir || children !== null) {
      return;
    }
    setLoading(true);
    try {
      const listing = await fetchTree(entry.path, new AbortController().signal);
      setChildren(listing.entries);
    } catch (err) {
      if (err instanceof SearchHttpError) {
        onAuthFailure?.(err);
      }
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [children, entry.dir, entry.path, onAuthFailure]);

  const expand = (): void => {
    if (!entry.dir) {
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next) {
      void loadKids();
    }
  };

  const picked = pickedPaths.has(entry.path);
  const current = !entry.dir && activePath === entry.path;
  const hidden = entry.name.startsWith(".");
  const rowClass = [
    "tree-row",
    picked ? "picked" : "",
    current ? "current" : "",
    hidden ? "dim" : "",
    entry.dir ? "is-dir" : "is-file",
  ]
    .filter((item) => item !== "")
    .join(" ");

  return (
    <div className="tree-node">
      <div
        className={rowClass}
        style={{ paddingLeft: `${0.28 + depth * 0.78}rem` }}
      >
        {entry.dir ? (
          <button
            type="button"
            className="tree-twist"
            aria-label="toggle"
            aria-expanded={expanded}
            onClick={expand}
          >
            <IconChevron open={expanded} />
          </button>
        ) : (
          <span className="tree-twist" />
        )}
        <button
          type="button"
          className="tree-select"
          aria-pressed={picked}
          onClick={() => {
            onTogglePick(entry);
          }}
        >
          <span className={picked ? "tree-check on" : "tree-check"}>
            {picked ? <IconCheck /> : null}
          </span>
          <span className="tree-kind" aria-hidden="true">
            <FileIcon path={entry.path} isDir={entry.dir} open={expanded} />
          </span>
          <span className="tree-name">{entry.name}</span>
        </button>
      </div>
      {entry.dir && expanded ? (
        <div className="tree-children">
          {loading && children === null ? (
            <div
              className="tree-muted tree-loading"
              style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
            >
              <span className="tree-spinner" />
            </div>
          ) : (
            (children ?? []).map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                pickedPaths={pickedPaths}
                onTogglePick={onTogglePick}
                {...(onAuthFailure !== undefined ? { onAuthFailure } : {})}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function FileTree({
  open,
  onToggle,
  rootLabel,
  activePath,
  picks,
  scope,
  style,
  onTogglePick,
  onSearchIn,
  onSearchOut,
  onClear,
  onAuthFailure,
}: {
  open: boolean;
  onToggle: () => void;
  rootLabel: string;
  activePath: string | null;
  picks: TreePick[];
  scope: "all" | "include" | "exclude";
  style?: React.CSSProperties | undefined;
  onTogglePick: (entry: TreeEntry) => void;
  onSearchIn: () => void;
  onSearchOut: () => void;
  onClear: () => void;
  onAuthFailure?: (err: SearchHttpError) => void;
}) {
  const { t } = useLocale();
  const [root, setRoot] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const picked = new Set(picks.map((item) => item.path));
  const n = picks.length;
  const canUse = n > 0;
  const label = rootLabel || t("treeTitle");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 16 && !cancelled; attempt++) {
        try {
          const listing = await fetchTree("", new AbortController().signal);
          if (cancelled) {
            return;
          }
          setRoot(listing.entries);
          setError(null);
          return;
        } catch (err) {
          if (cancelled) {
            return;
          }
          if (err instanceof SearchHttpError) {
            onAuthFailure?.(err);
            if (err.status === 401 || err.status === 403) {
              setError(err.body.message);
              return;
            }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!cancelled) {
        setError(t("treeError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAuthFailure, t, tick]);

  return (
    <aside
      className={open ? "tree-pane" : "tree-pane collapsed"}
      style={style}
      aria-label={t("treeTitle")}
    >
      {open ? (
        <>
          <div className="tree-head">
            <div className="tree-brand">
              <BrandMark />
              <div className="tree-brand-copy">
                <h1>{t("appTitle")}</h1>
                <p className="tagline" title={label}>
                  {label}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="tree-toggle"
              onClick={onToggle}
              aria-expanded="true"
              aria-label={t("treeHide")}
              title={t("treeHide")}
            >
              <IconPanel open />
            </button>
          </div>
          {canUse ? (
            <div className="tree-actions">
              <div className="tree-picked">
                <span className="tree-picked-dot" />
                {t("treePicked", { n })}
              </div>
              <div className="tree-seg" role="group">
                <button
                  type="button"
                  aria-pressed={scope === "include"}
                  title={t("treeSearchIn")}
                  onClick={onSearchIn}
                >
                  <IconTarget />
                  <span>{t("treeSearchIn")}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={scope === "exclude"}
                  title={t("treeSearchOut")}
                  onClick={onSearchOut}
                >
                  <IconMinusCircle />
                  <span>{t("treeSearchOut")}</span>
                </button>
                <button type="button" title={t("treeClear")} onClick={onClear}>
                  <IconX />
                  <span>{t("treeClear")}</span>
                </button>
              </div>
            </div>
          ) : null}
          <div className="tree-scroll">
            {error !== null ? (
              <div className="tree-error">
                <div>{error}</div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setRoot(null);
                    setTick((count) => count + 1);
                  }}
                >
                  {t("treeRetry")}
                </button>
              </div>
            ) : root === null ? (
              <div className="tree-muted tree-loading">
                <span className="tree-spinner" />
                <span>{t("treeLoading")}</span>
              </div>
            ) : root.length === 0 ? (
              <div className="tree-empty">
                <IconFolderEmpty />
                <p>{t("treeEmpty")}</p>
              </div>
            ) : (
              root.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  activePath={activePath}
                  pickedPaths={picked}
                  onTogglePick={onTogglePick}
                  {...(onAuthFailure !== undefined ? { onAuthFailure } : {})}
                />
              ))
            )}
          </div>
          <div className="tree-foot">
            <LocaleToggle />
          </div>
        </>
      ) : (
        <div className="tree-rail">
          <button
            type="button"
            className="brand-mark-btn"
            onClick={onToggle}
            title={t("appTitle")}
          >
            <BrandMark />
          </button>
          <button
            type="button"
            className="tree-toggle"
            onClick={onToggle}
            aria-expanded="false"
            aria-label={t("treeShow")}
            title={t("treeShow")}
          >
            <IconPanel open={false} />
          </button>
          {n > 0 ? (
            <button
              type="button"
              className="tree-rail-count"
              onClick={onToggle}
              title={t("treePicked", { n })}
            >
              {n > 99 ? "99+" : n}
            </button>
          ) : null}
          <div className="tree-rail-grow" />
          <LocaleToggle />
        </div>
      )}
    </aside>
  );
}

function IconFolderEmpty() {
  return (
    <svg className="tree-empty-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M4 9.5h8.2l2.2 2.4H28v13.6H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function useTreeOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(loadOpen);
  const toggle = (): void => {
    setOpen((current) => {
      const next = !current;
      localStorage.setItem(TREE_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  };
  return [open, toggle];
}
