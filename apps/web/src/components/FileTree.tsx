import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SearchHttpError } from "../api/http.ts";
import {
  fetchRootTreeRetry,
  fetchTree,
  type TreeEntry,
} from "../api/treeClient.ts";
import { formatSearchCount } from "../searchCount.ts";
import { useLocale } from "../hooks/useLocale.ts";
import {
  mtimeAfterMs,
  TIME_RANGES,
  timeRangeMsgKey,
  type TimeRange,
} from "../timeRange.ts";
import { parseGlobs } from "../globs.ts";
import {
  pickChipLabel,
  pickMark,
  pickParentLabel,
  type TreePick,
} from "../treePicks.ts";
import {
  BrandMark,
  FileIcon,
  IconCheck,
  IconChevron,
  IconDash,
  IconHistory,
  IconLock,
  IconLogout,
  IconPanel,
  IconSliders,
  IconRailExpand,
  IconX,
} from "./icons.tsx";
import { LocaleToggle, ThemeToggle } from "./StatusBar.tsx";

export const TREE_OPEN_KEY = "web-grep.treeOpen.v2";
const TREE_FILTERS_KEY = "web-grep.treeFilters.v1";
/** Matches `--rail-w` in styles.css (L-RAIL). */
export const TREE_RAIL_WIDTH = 56;

function loadOpen(): boolean {
  return localStorage.getItem(TREE_OPEN_KEY) !== "0";
}

/**
 * Big folders render in batches; the next batch loads as the tail scrolls into
 * view. Each batch doubles so a jump to the bottom needs only a few rounds.
 */
const WINDOW_INITIAL = 200;
const NO_ENTRIES: TreeEntry[] = [];

function useWindowedEntries(entries: TreeEntry[], revealPath: string | null) {
  const [count, setCount] = useState(WINDOW_INITIAL);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  const windowed =
    typeof IntersectionObserver !== "undefined" &&
    entries.length > WINDOW_INITIAL;
  // Never hide the row that should be revealed.
  const revealIndex =
    revealPath === null
      ? -1
      : entries.findIndex(
          (entry) =>
            entry.path === revealPath ||
            revealPath.startsWith(`${entry.path}/`),
        );
  const limit = windowed
    ? Math.min(entries.length, Math.max(count, revealIndex + 1))
    : entries.length;
  const more = entries.length - limit;
  const loadMore = (): void => {
    setCount(limit * 2);
  };
  useEffect(() => {
    const node = sentinelRef.current;
    if (more <= 0 || node === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (hits) => {
        if (hits.some((hit) => hit.isIntersecting)) {
          setCount(limit * 2);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [limit, more]);
  return {
    shown: limit === entries.length ? entries : entries.slice(0, limit),
    more,
    sentinelRef,
    loadMore,
  };
}

function MoreRow({
  more,
  depth,
  sentinelRef,
  onClick,
}: {
  more: number;
  depth: number;
  sentinelRef: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      ref={sentinelRef}
      type="button"
      className="tree-row tree-more"
      style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
      onClick={onClick}
    >
      {t("treeMore", { n: more })}
    </button>
  );
}

type TreeUi = {
  /** Row that owns the single Tab stop (roving tabindex). */
  focusPath: string | null;
  setFocusPath: (path: string | null) => void;
  /** Latest value, safe to read inside event handlers between renders. */
  getFocusPath: () => string | null;
  /** Path to unfold ancestors for and scroll into view. */
  revealPath: string | null;
};

const TreeUiContext = createContext<TreeUi>({
  focusPath: null,
  setFocusPath: () => undefined,
  getFocusPath: () => null,
  revealPath: null,
});

type NodeProps = {
  entry: TreeEntry;
  depth: number;
  activePath: string | null;
  picks: TreePick[];
  mtimeAfter?: number | undefined;
  excludeGlobs?: string[];
  parentListed?: TreeEntry[] | null;
  coveringListed?: TreeEntry[] | null;
  ancestorTruncated?: boolean;
  expandedPaths: Set<string>;
  firstRoot?: boolean;
  onTogglePick: (
    entry: TreeEntry,
    listedChildren?: TreeEntry[] | null,
    coveringChildren?: TreeEntry[] | null,
    truncated?: boolean,
  ) => void;
  onOpenFile?: (path: string) => void;
  onAuthFailure?: (err: SearchHttpError) => void;
};

function FolderLoadError({
  depth,
  onRetry,
}: {
  depth: number;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  return (
    <div
      className="tree-error"
      style={{ paddingLeft: `${0.55 + depth * 0.78}rem` }}
    >
      <div>{t("treeFolderError")}</div>
      <button type="button" className="tree-retry" onClick={onRetry}>
        {t("treeRetry")}
      </button>
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  activePath,
  picks,
  mtimeAfter,
  excludeGlobs = [],
  parentListed = null,
  coveringListed = null,
  ancestorTruncated = false,
  expandedPaths,
  firstRoot = false,
  onTogglePick,
  onOpenFile,
  onAuthFailure,
}: NodeProps) {
  const { t } = useLocale();
  const { focusPath, setFocusPath, getFocusPath, revealPath } =
    useContext(TreeUiContext);
  const [expanded, setExpanded] = useState(
    () => entry.dir && expandedPaths.has(entry.path),
  );
  // Unfold once per new reveal target (state adjusted during render, not in an effect).
  const [seenReveal, setSeenReveal] = useState<string | null>(null);
  if (revealPath !== seenReveal) {
    setSeenReveal(revealPath);
    if (
      entry.dir &&
      revealPath !== null &&
      revealPath.startsWith(`${entry.path}/`) &&
      !expanded
    ) {
      expandedPaths.add(entry.path);
      setExpanded(true);
    }
  }
  const selectRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!entry.dir && revealPath === entry.path) {
      selectRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [entry.dir, entry.path, revealPath]);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [reload, setReload] = useState(0);
  const win = useWindowedEntries(children ?? NO_ENTRIES, revealPath);

  useEffect(() => {
    if (!entry.dir || !expanded) {
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setDenied(false);
    setFailed(false);
    void fetchTree(entry.path, ac.signal, mtimeAfter, excludeGlobs)
      .then((listing) => {
        if (!cancelled) {
          setDenied(false);
          setFailed(false);
          setTruncated(listing.truncated);
          setChildren(listing.entries);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof SearchHttpError) {
          onAuthFailure?.(err);
          if (err.body.code === "DENIED") {
            setDenied(true);
            setFailed(false);
            setTruncated(false);
            setChildren([]);
            return;
          }
        }
        setFailed(true);
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
    reload,
  ]);

  const expand = (): void => {
    if (!entry.dir) {
      return;
    }
    const next = !expanded;
    if (next) {
      expandedPaths.add(entry.path);
    } else {
      expandedPaths.delete(entry.path);
      if (getFocusPath()?.startsWith(`${entry.path}/`)) {
        setFocusPath(entry.path);
      }
    }
    setExpanded(next);
  };

  const mark = pickMark(
    entry.path,
    entry.dir,
    picks,
    entry.dir ? children : null,
    truncated,
  );
  const current = !entry.dir && activePath === entry.path;
  const hidden = entry.name.startsWith(".");
  const checked = mark === "on" || mark === "covered";
  const pressed = mark === "partial" ? "mixed" : checked;
  const rowClass = [
    "tree-row",
    checked || mark === "partial" ? "picked" : "",
    current ? "current" : "",
    hidden ? "dim" : "",
    entry.dir ? "is-dir" : "is-file",
  ]
    .filter((item) => item !== "")
    .join(" ");

  const toggleThisPick = (): void => {
    const covering =
      mark === "on" && entry.dir && children !== null
        ? children
        : coveringListed;
    onTogglePick(
      entry,
      entry.dir ? children : parentListed,
      covering,
      truncated || ancestorTruncated,
    );
  };

  return (
    <div
      className="tree-node"
      role="treeitem"
      aria-label={entry.name}
      aria-level={depth + 1}
      aria-selected={checked}
      {...(entry.dir ? { "aria-expanded": expanded } : {})}
    >
      <div
        className={rowClass}
        style={{ paddingLeft: `${0.28 + depth * 0.78}rem` }}
        data-tree-dir={entry.dir ? "1" : "0"}
        data-tree-expanded={entry.dir ? (expanded ? "1" : "0") : undefined}
      >
        {entry.dir ? (
          <button
            type="button"
            className="tree-twist"
            aria-label={expanded ? t("treeCollapse") : t("treeExpand")}
            aria-expanded={expanded}
            tabIndex={-1}
            onClick={expand}
          >
            <IconChevron open={expanded} />
          </button>
        ) : (
          <span className="tree-twist" />
        )}
        <button
          type="button"
          ref={selectRef}
          className="tree-select"
          tabIndex={
            focusPath === entry.path || (focusPath === null && firstRoot)
              ? 0
              : -1
          }
          onFocus={() => {
            setFocusPath(entry.path);
          }}
          {...(entry.dir
            ? { "aria-expanded": expanded }
            : onOpenFile === undefined
              ? { "aria-pressed": pressed }
              : {})}
          onClick={() => {
            if (entry.dir) {
              expand();
              return;
            }
            if (onOpenFile !== undefined) {
              onOpenFile(entry.path);
              return;
            }
            toggleThisPick();
          }}
        >
          <span className="tree-kind" aria-hidden="true">
            <FileIcon path={entry.path} isDir={entry.dir} open={expanded} />
          </span>
          <span className="tree-name" title={entry.name}>
            {entry.name}
          </span>
        </button>
        <button
          type="button"
          className="tree-pick"
          aria-pressed={pressed}
          aria-label={`${t("treePick")} ${entry.name}`}
          tabIndex={-1}
          onClick={toggleThisPick}
        >
          <span className={mark === "off" ? "tree-check" : "tree-check on"}>
            {mark === "partial" ? (
              <IconDash />
            ) : checked ? (
              <IconCheck />
            ) : null}
          </span>
        </button>
      </div>
      {entry.dir && expanded ? (
        <div
          className="tree-children"
          role="group"
          style={
            {
              "--guide-x": `${0.28 + depth * 0.78}rem`,
            } as React.CSSProperties
          }
        >
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
          ) : failed && children === null ? (
            <FolderLoadError
              depth={depth + 1}
              onRetry={() => {
                setReload((count) => count + 1);
              }}
            />
          ) : loading && children === null ? (
            <TreeSkeleton depth={depth + 1} />
          ) : (
            <>
              {failed ? (
                <FolderLoadError
                  depth={depth + 1}
                  onRetry={() => {
                    setReload((count) => count + 1);
                  }}
                />
              ) : null}
              {(children ?? []).length === 0 ? (
                <div
                  className="tree-row empty-folder"
                  style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
                >
                  <span className="tree-name">{t("treeEmptyFolder")}</span>
                </div>
              ) : (
                win.shown.map((child) => (
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
                    ancestorTruncated={truncated || ancestorTruncated}
                    expandedPaths={expandedPaths}
                    onTogglePick={onTogglePick}
                    {...(onOpenFile !== undefined ? { onOpenFile } : {})}
                    {...(onAuthFailure !== undefined ? { onAuthFailure } : {})}
                  />
                ))
              )}
              {win.more > 0 ? (
                <MoreRow
                  more={win.more}
                  depth={depth}
                  sentinelRef={win.sentinelRef}
                  onClick={win.loadMore}
                />
              ) : null}
              {truncated ? (
                <div
                  className="tree-row tree-truncated"
                  style={{ paddingLeft: `${1.15 + depth * 0.78}rem` }}
                >
                  <span className="tree-name" title={t("treeTruncated")}>
                    {t("treeTruncated")}
                  </span>
                </div>
              ) : null}
            </>
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
    truncated?: boolean,
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
  const [rootTruncated, setRootTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const shownPicks = picks.filter((pick) => !pick.exclude);
  const n = shownPicks.length;
  const canClear =
    picks.length > 0 || excludeGlobs.trim() !== "" || timeRange !== null;
  const label = rootLabel || t("treeTitle");
  const [mtimeAfter, setMtimeAfter] = useState<number | undefined>(() =>
    timeRange !== null ? mtimeAfterMs(timeRange) : undefined,
  );
  const [excludeFilter, setExcludeFilter] = useState(excludeGlobs);
  const excludeInputRef = useRef<HTMLInputElement>(null);
  const [expandedPaths] = useState(() => new Set<string>());
  const [filtersOpen, toggleFilters] = useFiltersOpen();
  const rootWin = useWindowedEntries(root ?? NO_ENTRIES, activePath);
  const [pickedOpen, setPickedOpen] = useState(false);
  const [focusPath, setFocusState] = useState<string | null>(null);
  const focusRef = useRef<string | null>(null);
  const setFocusPath = (path: string | null): void => {
    focusRef.current = path;
    setFocusState(path);
  };
  const treeUi: TreeUi = {
    focusPath,
    setFocusPath,
    getFocusPath: () => focusRef.current,
    revealPath: activePath,
  };
  const scopeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickedOpen) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      if (!scopeRef.current?.contains(event.target as Node)) {
        setPickedOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPickedOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickedOpen]);
  const activeFilters =
    (excludeGlobs.trim() !== "" ? 1 : 0) + (timeRange !== null ? 1 : 0);

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

  const excludeList = useMemo(
    () => parseGlobs(excludeFilter),
    [excludeFilter],
  );

  useEffect(() => {
    if (!sessionReady) {
      expandedPaths.clear();
      setRoot(null);
      setRootTruncated(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    const exclude = parseGlobs(excludeFilter);
    void (async () => {
      const result = await fetchRootTreeRetry(
        ac.signal,
        mtimeAfter,
        exclude,
        (err) => {
          if (err instanceof SearchHttpError) {
            onAuthFailure?.(err);
          }
        },
      );
      if (ac.signal.aborted || (!result.ok && result.kind === "aborted")) {
        return;
      }
      if (result.ok) {
        setRoot(result.listing.entries);
        setRootTruncated(result.listing.truncated);
        setFocusPath(null);
        setError(null);
        return;
      }
      if (result.kind === "auth") {
        setError(result.err.body.message);
        return;
      }
      setError(t("treeError"));
    })();
    return () => {
      ac.abort();
    };
  }, [
    excludeFilter,
    expandedPaths,
    mtimeAfter,
    onAuthFailure,
    sessionReady,
    t,
    tick,
  ]);

  return (
    <aside
      className={
        open
          ? picks.length > 0
            ? "tree-pane has-picks"
            : "tree-pane"
          : "tree-pane collapsed rail"
      }
      style={style}
      aria-label={open ? t("treeTitle") : t("treeCollapsed")}
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
            <div className="tree-scope" ref={scopeRef}>
              <button
                type="button"
                className={pickedOpen ? "tree-picked is-open" : "tree-picked"}
                aria-expanded={n > 0 ? pickedOpen : undefined}
                disabled={n === 0}
                onClick={() => {
                  setPickedOpen((current) => !current);
                }}
              >
                <span className="tree-picked-dot" />
                {t("treePicked", { n })}
                {n > 0 ? <IconChevron open={pickedOpen} /> : null}
              </button>
              {pickedOpen && n > 0 ? (
                <div className="tree-picked-pop" role="list">
                  {shownPicks.map((pick) => (
                    <div key={pick.path} className="pick-chip" role="listitem">
                      <span
                        className="pick-chip-name"
                        title={pick.path}
                        aria-hidden="true"
                      >
                        {pickChipLabel(pick)}
                      </span>
                      <span className="pick-chip-path" aria-hidden="true">
                        {pickParentLabel(pick)}
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
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className={
                  filtersOpen
                    ? "tree-icon-btn tree-scope-end is-on"
                    : "tree-icon-btn tree-scope-end"
                }
                aria-expanded={filtersOpen}
                aria-label={t("treeFilters")}
                title={t("treeFilters")}
                onClick={toggleFilters}
              >
                <IconSliders />
                {activeFilters > 0 ? (
                  <span className="tree-icon-badge">{activeFilters}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="tree-icon-btn tree-clear"
                disabled={!canClear}
                aria-label={t("treeClear")}
                title={t("treeClear")}
                onClick={onClear}
              >
                <IconX />
              </button>
            </div>
            {filtersOpen ? (
              <div className="tree-filters-body">
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
                <span className="tree-time-by">{t("timeRangeBy")}</span>
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
            ) : null}
          </div>
          <div
            className="tree-scroll"
            role="tree"
            aria-label={t("treeTitle")}
            aria-multiselectable="true"
            onKeyDown={onTreeKeyDown}
          >
            <TreeUiContext.Provider value={treeUi}>
            {error !== null ? (
              <div className="tree-error">
                <div>{error}</div>
                <button
                  type="button"
                  className="tree-retry"
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
              <>
                {rootWin.shown.map((entry, index) => (
                  <TreeNode
                    key={`${entry.path}:${mtimeAfter ?? "all"}:${excludeFilter}`}
                    firstRoot={index === 0}
                    entry={entry}
                    depth={0}
                    activePath={activePath}
                    picks={picks}
                    mtimeAfter={mtimeAfter}
                    excludeGlobs={excludeList}
                    parentListed={root}
                    expandedPaths={expandedPaths}
                    onTogglePick={onTogglePick}
                    {...(onOpenFile !== undefined ? { onOpenFile } : {})}
                    {...(onAuthFailure !== undefined ? { onAuthFailure } : {})}
                  />
                ))}
                {rootWin.more > 0 ? (
                  <MoreRow
                    more={rootWin.more}
                    depth={-1}
                    sentinelRef={rootWin.sentinelRef}
                    onClick={rootWin.loadMore}
                  />
                ) : null}
                {rootTruncated ? (
                  <div className="tree-row tree-truncated">
                    <span className="tree-name" title={t("treeTruncated")}>
                      {t("treeTruncated")}
                    </span>
                  </div>
                ) : null}
              </>
            )}
            </TreeUiContext.Provider>
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
        <>
          <div className="tree-head">
            <BrandMark />
            <button
              type="button"
              className="rail-expand"
              onClick={onToggle}
              aria-expanded="false"
              aria-label={t("treeShow")}
              title={t("treeShow")}
            >
              <IconRailExpand />
            </button>
          </div>
          <div className="rail-stack">
            <button
              type="button"
              className="rail-picked-badge"
              onClick={onToggle}
              title={t("treePicked", { n })}
            >
              <span className="dot" />
              {n > 99 ? "99+" : n}
            </button>
            <button
              type="button"
              className={
                timeRange !== null ? "rail-time-btn is-active" : "rail-time-btn"
              }
              onClick={onToggle}
              title={
                timeRange !== null
                  ? `${t("timeRange")}: ${t(timeRangeMsgKey(timeRange))}`
                  : t("timeRange")
              }
            >
              <IconHistory />
            </button>
          </div>
          <div className="tree-foot">
            <ThemeToggle />
            <LocaleToggle compact />
            <button
              type="button"
              className="rail-logout"
              disabled={!canLogout || onLogout === undefined}
              onClick={() => {
                onLogout?.();
              }}
              title={t("logout")}
              aria-label={t("logout")}
            >
              <IconLogout />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function useFiltersOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(
    () => localStorage.getItem(TREE_FILTERS_KEY) !== "0",
  );
  const toggle = (): void => {
    setOpen((current) => {
      const next = !current;
      localStorage.setItem(TREE_FILTERS_KEY, next ? "1" : "0");
      return next;
    });
  };
  return [open, toggle];
}

/** Arrow keys move between rows; Left/Right fold/unfold; Space picks. */
function onTreeKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains("tree-select")) {
    return;
  }
  const row = target.closest<HTMLElement>(".tree-row");
  if (row === null) {
    return;
  }
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      ".tree-row .tree-select",
    ),
  ];
  const index = rows.indexOf(target);
  const focusAt = (i: number): void => {
    rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
  };
  const isDir = row.dataset.treeDir === "1";
  const isOpen = row.dataset.treeExpanded === "1";
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusAt(index + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      focusAt(index - 1);
      break;
    case "Home":
      event.preventDefault();
      focusAt(0);
      break;
    case "End":
      event.preventDefault();
      focusAt(rows.length - 1);
      break;
    case "ArrowRight":
      if (isDir) {
        event.preventDefault();
        if (!isOpen) {
          row.querySelector<HTMLElement>(".tree-twist")?.click();
        } else {
          focusAt(index + 1);
        }
      }
      break;
    case "ArrowLeft":
      event.preventDefault();
      if (isDir && isOpen) {
        row.querySelector<HTMLElement>(".tree-twist")?.click();
      } else {
        const parent = row
          .closest(".tree-children")
          ?.parentElement?.querySelector<HTMLElement>(":scope > .tree-row .tree-select");
        parent?.focus();
      }
      break;
    case " ":
      event.preventDefault();
      row.querySelector<HTMLElement>(".tree-pick")?.click();
      break;
    default:
      break;
  }
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
