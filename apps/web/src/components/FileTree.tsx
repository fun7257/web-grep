import { useEffect, useRef, useState } from "react";
import { SearchHttpError } from "../api/searchClient.ts";
import { fetchFileCount, fetchTree, type TreeEntry } from "../api/treeClient.ts";
import { formatSearchCount } from "../searchCount.ts";
import { useLocale } from "../hooks/useLocale.ts";
import {
  mtimeAfterMs,
  TIME_RANGES,
  timeRangeMsgKey,
  type TimeRange,
} from "../timeRange.ts";
import { matchesAnyGlob, parseGlobs } from "../globs.ts";
import { pickMark, type TreePick } from "../treePicks.ts";
import {
  BrandMark,
  FileIcon,
  IconCheck,
  IconChevron,
  IconDash,
  IconExpand,
  IconHistory,
  IconLock,
  IconLogout,
  IconPanel,
  IconX,
} from "./icons.tsx";
import { LocaleToggle, ThemeToggle } from "./StatusBar.tsx";

const TREE_OPEN_KEY = "web-grep.treeOpen.v2";
export const TREE_RAIL_WIDTH = 56;

function loadOpen(): boolean {
  return localStorage.getItem(TREE_OPEN_KEY) !== "0";
}

type NodeProps = {
  entry: TreeEntry;
  depth: number;
  activePath: string | null;
  picks: TreePick[];
  mtimeAfter?: number | undefined;
  excludeGlobs?: string[];
  parentListed?: TreeEntry[] | null;
  coveringListed?: TreeEntry[] | null;
  onTogglePick: (
    entry: TreeEntry,
    listedChildren?: TreeEntry[] | null,
    coveringChildren?: TreeEntry[] | null,
  ) => void;
  onOpenFile?: (path: string) => void;
  onAuthFailure?: (err: SearchHttpError) => void;
};

function TreeNode({
  entry,
  depth,
  activePath,
  picks,
  mtimeAfter,
  excludeGlobs = [],
  parentListed = null,
  coveringListed = null,
  onTogglePick,
  onOpenFile,
  onAuthFailure,
}: NodeProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!entry.dir || !expanded) {
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setDenied(false);
    void fetchTree(entry.path, ac.signal, mtimeAfter, excludeGlobs)
      .then((listing) => {
        if (!cancelled) {
          setDenied(false);
          setChildren(listing.entries);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof SearchHttpError) {
          onAuthFailure?.(err);
          setDenied(err.body.code === "DENIED");
        }
        setChildren([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    entry.dir,
    entry.path,
    excludeGlobs,
    expanded,
    mtimeAfter,
    onAuthFailure,
  ]);

  const expand = (): void => {
    if (!entry.dir) {
      return;
    }
    setExpanded((current) => !current);
  };

  const mark = pickMark(
    entry.path,
    entry.dir,
    picks,
    entry.dir ? children : null,
  );
  const current = !entry.dir && activePath === entry.path;
  const hidden = entry.name.startsWith(".");
  const checked = mark === "on" || mark === "covered";
  const rowClass = [
    "tree-row",
    checked || mark === "partial" ? "picked" : "",
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
          aria-pressed={mark === "partial" ? "mixed" : checked}
          onClick={() => {
            const covering =
              mark === "on" && entry.dir && children !== null
                ? children
                : coveringListed;
            onTogglePick(
              entry,
              entry.dir ? children : parentListed,
              covering,
            );
          }}
        >
          <span className={mark === "off" ? "tree-check" : "tree-check on"}>
            {mark === "partial" ? (
              <IconDash />
            ) : checked ? (
              <IconCheck />
            ) : null}
          </span>
          <span className="tree-kind" aria-hidden="true">
            <FileIcon path={entry.path} isDir={entry.dir} open={expanded} />
          </span>
          <span className="tree-name" title={entry.name}>
            {entry.name}
          </span>
        </button>
        {!entry.dir ? (
          <button
            type="button"
            className="tree-open-file"
            title={t("treeOpenFile")}
            aria-label={t("treeOpenFile")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenFile?.(entry.path);
            }}
          >
            <IconExpand />
          </button>
        ) : null}
      </div>
      {entry.dir && expanded ? (
        <div className="tree-children">
          {denied ? (
            <div
              className="tree-row denied"
              style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
            >
              <span className="tree-lock" aria-hidden="true">
                <IconLock />
              </span>
              <span className="tree-name">{t("treeDenied")}</span>
            </div>
          ) : loading && children === null ? (
            <TreeSkeleton depth={depth + 1} />
          ) : (children ?? []).length === 0 ? (
            <div
              className="tree-row empty-folder"
              style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
            >
              <span className="tree-name">{t("treeEmptyFolder")}</span>
            </div>
          ) : (
            (children ?? []).map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                picks={picks}
                mtimeAfter={mtimeAfter}
                excludeGlobs={excludeGlobs}
                parentListed={children}
                coveringListed={
                  mark === "on" && entry.dir && children !== null
                    ? children
                    : coveringListed
                }
                onTogglePick={onTogglePick}
                {...(onOpenFile !== undefined ? { onOpenFile } : {})}
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
  style,
  onTogglePick,
  onOpenFile,
  onRemovePick,
  onClear,
  excludeGlobs = "",
  onExcludeGlobsChange,
  onExcludeApply,
  onAuthFailure,
  sessionReady = true,
  canLogout = false,
  onLogout,
  timeRange = null,
  onTimeRange,
  searchCount = 0,
}: {
  open: boolean;
  onToggle: () => void;
  rootLabel: string;
  activePath: string | null;
  picks: TreePick[];
  style?: React.CSSProperties | undefined;
  onTogglePick: (
    entry: TreeEntry,
    listedChildren?: TreeEntry[] | null,
    coveringChildren?: TreeEntry[] | null,
  ) => void;
  onOpenFile?: (path: string) => void;
  onRemovePick?: (pick: TreePick) => void;
  onClear: () => void;
  excludeGlobs?: string;
  onExcludeGlobsChange?: (value: string) => void;
  onExcludeApply?: (value: string) => void;
  onAuthFailure?: (err: SearchHttpError) => void;
  sessionReady?: boolean;
  canLogout?: boolean;
  onLogout?: () => void;
  timeRange?: TimeRange | null;
  onTimeRange?: (value: TimeRange | null) => void;
  searchCount?: number;
}) {
  const { t } = useLocale();
  const [root, setRoot] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const n = fileCount;
  const canClear =
    picks.length > 0 || excludeGlobs.trim() !== "" || timeRange !== null;
  const label = rootLabel || t("treeTitle");
  const [mtimeAfter, setMtimeAfter] = useState<number | undefined>(() =>
    timeRange !== null ? mtimeAfterMs(timeRange) : undefined,
  );
  const [excludeFilter, setExcludeFilter] = useState(excludeGlobs);
  const excludeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMtimeAfter(timeRange !== null ? mtimeAfterMs(timeRange) : undefined);
  }, [timeRange]);

  const applyExclude = (raw: string): void => {
    setExcludeFilter(raw);
    onExcludeApply?.(raw);
  };

  useEffect(() => {
    const node = excludeInputRef.current;
    if (node !== null && document.activeElement === node) {
      return;
    }
    applyExclude(excludeGlobs);
  }, [excludeGlobs]);

  const excludeList = parseGlobs(excludeFilter);

  useEffect(() => {
    const exclude = parseGlobs(excludeFilter);
    const files = picks.filter(
      (item) => !item.dir && !matchesAnyGlob(item.path, exclude),
    );
    const dirs = picks.filter((item) => item.dir);
    if (dirs.length === 0) {
      setFileCount(files.length);
      return;
    }
    const ac = new AbortController();
    void Promise.all(
      dirs.map((item) =>
        fetchFileCount(item.path, ac.signal, mtimeAfter, exclude),
      ),
    )
      .then((counts) => {
        setFileCount(
          files.length + counts.reduce((sum, count) => sum + count, 0),
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setFileCount(picks.length);
      });
    return () => {
      ac.abort();
    };
  }, [excludeFilter, mtimeAfter, picks]);

  useEffect(() => {
    if (!sessionReady) {
      setRoot(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const exclude = parseGlobs(excludeFilter);
    void (async () => {
      for (let attempt = 0; attempt < 16 && !cancelled; attempt++) {
        try {
          const listing = await fetchTree(
            "",
            new AbortController().signal,
            mtimeAfter,
            exclude,
          );
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
  }, [excludeFilter, mtimeAfter, onAuthFailure, sessionReady, t, tick]);

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
          <div className="tree-filters">
            <div className="tree-actions">
              <div className="tree-picked">
                <span className="tree-picked-dot" />
                {t("treePicked", { n })}
              </div>
              <button
                type="button"
                className="tree-clear"
                disabled={!canClear}
                title={t("treeClear")}
                onClick={onClear}
              >
                <IconX />
                <span>{t("treeClear")}</span>
              </button>
            </div>
            {picks.length > 0 ? (
              <div className="tree-picked-chips">
                {picks.map((pick) => (
                  <span key={pick.path} className="pick-chip">
                    <span className="pick-chip-name" title={pick.path} aria-hidden="true">
                      {pick.path.split("/").pop() || pick.path}
                    </span>
                    <button
                      type="button"
                      className="pick-chip-x"
                      title={t("excludeClear")}
                      aria-label={t("excludeClear")}
                      onClick={() => {
                        onRemovePick?.(pick);
                      }}
                    >
                      <IconX />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="exclude-row">
              <span className="exclude-label">{t("excludeGlobLabel")}</span>
              <div
                className={
                  excludeGlobs.trim() !== ""
                    ? "exclude-chip has-value"
                    : "exclude-chip"
                }
              >
                <input
                  ref={excludeInputRef}
                  type="text"
                  className="exclude-chip-input"
                  placeholder={t("excludeGlobs")}
                  value={excludeGlobs}
                  aria-label={t("excludeGlobLabel")}
                  onChange={(event) =>
                    onExcludeGlobsChange?.(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }
                    event.preventDefault();
                    applyExclude(excludeGlobs);
                    event.currentTarget.blur();
                  }}
                  onBlur={() => {
                    applyExclude(excludeGlobs);
                  }}
                />
                <button
                  type="button"
                  className="exclude-chip-x"
                  title={t("excludeClear")}
                  aria-label={t("excludeClear")}
                  disabled={excludeGlobs.trim() === ""}
                  onClick={() => {
                    onExcludeGlobsChange?.("");
                    applyExclude("");
                  }}
                >
                  <IconX />
                </button>
              </div>
            </div>
            <div className="tree-time" title={t("timeRangeHint")}>
              <span className="tree-time-label">
                <IconHistory />
                {t("timeRange")}
              </span>
              <div
                className="tree-time-seg seg"
                role="group"
                aria-label={t("timeRange")}
              >
                {TIME_RANGES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={timeRange === id}
                    title={t("timeRangeHint")}
                    onClick={() => {
                      onTimeRange?.(timeRange === id ? null : id);
                    }}
                  >
                    {t(timeRangeMsgKey(id))}
                  </button>
                ))}
              </div>
            </div>
          </div>
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
              <div className="tree-muted tree-loading" aria-busy="true">
                <TreeSkeleton depth={0} rows={4} />
              </div>
            ) : root.length === 0 ? (
              <div className="tree-empty">
                <IconFolderEmpty />
                <p>
                  {timeRange !== null || excludeList.length > 0
                    ? t("treeEmptyFiltered")
                    : t("treeEmpty")}
                </p>
              </div>
            ) : (
              root.map((entry) => (
                <TreeNode
                  key={`${entry.path}:${mtimeAfter ?? "all"}:${excludeFilter}`}
                  entry={entry}
                  depth={0}
                  activePath={activePath}
                  picks={picks}
                  mtimeAfter={mtimeAfter}
                  excludeGlobs={excludeList}
                  parentListed={root}
                  onTogglePick={onTogglePick}
                  {...(onOpenFile !== undefined ? { onOpenFile } : {})}
                  {...(onAuthFailure !== undefined ? { onAuthFailure } : {})}
                />
              ))
            )}
          </div>
          <div className="tree-foot">
            <ThemeToggle />
            <LocaleToggle />
            <span
              className="search-count-badge"
              title={t("searchCountTitle", { n: searchCount })}
            >
              <span className="search-count-badge-label">
                {t("searchCountLabel")}
              </span>
              <span className="search-count-badge-stat">
                {formatSearchCount(searchCount)}
              </span>
            </span>
            {canLogout && onLogout !== undefined ? (
              <div className="tree-account">
                <button
                  type="button"
                  className="tree-logout"
                  onClick={onLogout}
                  title={t("logout")}
                  aria-label={t("logout")}
                >
                  <IconLogout />
                </button>
              </div>
            ) : null}
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
          {timeRange !== null ? (
            <button
              type="button"
              className="tree-rail-time"
              onClick={onToggle}
              title={`${t("timeRange")}: ${t(timeRangeMsgKey(timeRange))}`}
            >
              {t(timeRangeMsgKey(timeRange))}
            </button>
          ) : null}
          {canLogout && onLogout !== undefined ? (
            <button
              type="button"
              className="tree-logout"
              onClick={onLogout}
              title={t("logout")}
              aria-label={t("logout")}
            >
              <IconLogout />
            </button>
          ) : null}
          <ThemeToggle />
          <LocaleToggle />
        </div>
      )}
    </aside>
  );
}

function TreeSkeleton({
  depth,
  rows = 2,
}: {
  depth: number;
  rows?: number;
}) {
  return (
    <div className="tree-skel-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="tree-skel"
          style={{ paddingLeft: `${0.9 + depth * 0.78}rem` }}
        >
          <span className="skel-bar icon" />
          <span
            className="skel-bar name"
            style={{ maxWidth: `${88 + (index % 3) * 18}px` }}
          />
        </div>
      ))}
    </div>
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
