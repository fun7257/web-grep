import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextModal } from "./components/ContextModal.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { FilePreview } from "./components/FilePreview.tsx";
import {
  FileTree,
  TREE_RAIL_WIDTH,
  useTreeOpen,
} from "./components/FileTree.tsx";
import { HotkeyHelpModal } from "./components/HotkeyHelpModal.tsx";
import { IconListFlat, IconListGroup } from "./components/icons.tsx";
import { ResultList } from "./components/ResultList.tsx";
import { SearchBar } from "./components/SearchBar.tsx";
import { ShareModal } from "./components/ShareModal.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Toast } from "./components/Toast.tsx";
import { AuthDialog } from "./components/AuthDialog.tsx";
import { useHotkeys } from "./hooks/useHotkeys.ts";
import { LocaleProvider, useLocale } from "./hooks/useLocale.ts";
import { useResizablePanes } from "./hooks/useResizablePanes.ts";
import { useSearch } from "./hooks/useSearch.ts";
import { copyText } from "./copyText.ts";
import { useAuth } from "./hooks/useAuth.ts";
import {
  buildShareUrl,
  captureShareState,
  parseShareSearch,
  shareUrlSearch,
} from "./searchShare.ts";
import { picksToGlobs, picksToSearchGlobs, type TreePick, togglePick } from "./treePicks.ts";
import {
  compileParts,
  joinAbs,
  newPart,
  type QueryPart,
  type SearchModifiers,
  type SearchStack,
  stackedQuery,
  toRequest,
  toRgShareCommand,
} from "./searchStack.ts";
import {
  loadSearchHistory,
  pushSearchHistory,
  type SearchHistoryItem,
} from "./searchHistory.ts";
import { pushSearchNav, type SearchNavEntry } from "./searchNav.ts";
import {
  loadTimeRange,
  mtimeAfterMs,
  saveTimeRange,
  type TimeRange,
} from "./timeRange.ts";

const EMPTY_HL_TERMS: string[] = [];

function parseGlobs(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function partsFromFields(values: string[]): QueryPart[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map(newPart);
}

function AppShell() {
  const { t } = useLocale();
  const token = useAuth();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [parts, setParts] = useState<QueryPart[]>([]);
  const [fields, setFields] = useState<string[]>([""]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [treeOpen, toggleTree] = useTreeOpen();
  const [picks, setPicks] = useState<TreePick[]>([]);
  const [scope, setScope] = useState<"all" | "include" | "exclude">("all");
  const [modifiers, setModifiers] = useState<SearchModifiers>({
    caseSensitive: false,
    wordMatch: false,
    regex: false,
  });
  const [includeGlobs, setIncludeGlobs] = useState("");
  const [excludeGlobs, setExcludeGlobs] = useState("");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">(() => {
    return (
      (localStorage.getItem("web-grep.viewMode") as "grouped" | "flat") ||
      "grouped"
    );
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange | null>(loadTimeRange);
  const [searchHistory, setSearchHistory] = useState(loadSearchHistory);
  const [nav, setNav] = useState<{ stack: SearchNavEntry[]; index: number }>({
    stack: [],
    index: -1,
  });
  const skipNavRef = useRef(false);
  const stackRef = useRef<SearchStack | null>(null);
  const bootstrapped = useRef(false);
  const pendingSelect = useRef<{ path: string; line: number } | null>(null);

  const { treeWidth, hitsWidth, startResizeTree, startResizeHits } =
    useResizablePanes();

  const runSearch = search.submit;
  const cancelSearch = search.cancel;
  const resetSearch = search.reset;
  const selectedIndexClamped =
    search.hits.length === 0
      ? 0
      : Math.min(selectedIndex, search.hits.length - 1);
  const selectedHit = search.hits[selectedIndexClamped] ?? null;
  const lastStack = stackRef.current;
  const hlTerms = useMemo(
    () => lastStack?.parts.map((part) => part.value) ?? EMPTY_HL_TERMS,
    [lastStack],
  );
  const hlOpts = useMemo(
    () => ({
      caseSensitive: lastStack?.caseSensitive ?? false,
      wordMatch: lastStack?.wordMatch ?? false,
      regex: lastStack?.regex ?? false,
    }),
    [lastStack],
  );
  const rootAbs = token.meta?.root;
  const shareState = useMemo(
    () =>
      captureShareState({
        fields,
        fallbackParts: lastStack?.parts.map((part) => part.value),
        caseSensitive: modifiers.caseSensitive,
        wordMatch: modifiers.wordMatch,
        regex: modifiers.regex,
        includeGlobs,
        excludeGlobs,
        picks,
        scope,
        timeRange,
        ...(selectedHit !== null
          ? { hitPath: selectedHit.path, hitLine: selectedHit.line }
          : {}),
      }),
    [
      excludeGlobs,
      fields,
      includeGlobs,
      lastStack,
      modifiers,
      picks,
      scope,
      selectedHit,
      timeRange,
    ],
  );
  const webUrl =
    shareState !== null && selectedHit !== null
      ? buildShareUrl(window.location.href, shareState)
      : null;
  let rgCommand: string | null = null;
  if (
    selectedHit !== null &&
    shareState !== null &&
    rootAbs !== undefined &&
    rootAbs !== ""
  ) {
    const compiled = stackedQuery(shareState.parts, modifiers.regex);
    if (compiled.query !== "") {
      const include = parseGlobs(includeGlobs);
      const exclude = parseGlobs(excludeGlobs);
      let paths = [rootAbs];
      let globInclude = include;
      let globExclude = exclude;
      if (picks.length > 0 && scope === "exclude") {
        globExclude = [...picksToGlobs(picks), ...exclude];
      } else if (picks.length > 0) {
        paths = picks.map((item) =>
          item.path === "" ? rootAbs : joinAbs(rootAbs, item.path),
        );
      }
      rgCommand = toRgShareCommand({
        query: compiled.query,
        regex: modifiers.regex || compiled.regex,
        caseSensitive: modifiers.caseSensitive,
        wordMatch: modifiers.wordMatch,
        hidden: lastStack?.hidden ?? true,
        paths,
        globInclude,
        globExclude,
      });
    }
  }

  const selectHit = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const searchWithParts = useCallback(
    (
      nextParts: QueryPart[],
      nextScope: "all" | "include" | "exclude" = scope,
      extraInclude: string[] = [],
      nextModifiers: SearchModifiers = modifiers,
      nextTime: TimeRange | null = timeRange,
      nextPicks: TreePick[] = picks,
      nextIncludeRaw: string = includeGlobs,
      nextExcludeRaw: string = excludeGlobs,
    ) => {
      if (nextParts.length === 0) {
        return;
      }
      const compiled = compileParts(nextParts, nextModifiers.regex);
      if (compiled.query === "") {
        return;
      }
      const effective: "all" | "include" | "exclude" =
        nextPicks.length === 0
          ? "all"
          : nextScope === "exclude"
            ? "exclude"
            : "include";
      const globs = picksToSearchGlobs(
        nextPicks,
        effective,
        extraInclude,
        parseGlobs(nextIncludeRaw),
        parseGlobs(nextExcludeRaw),
      );

      const stack: SearchStack = {
        parts: nextParts,
        globInclude: globs.globInclude,
        globAnd: globs.globAnd,
        globExclude: globs.globExclude,
        path: "",
        caseSensitive: nextModifiers.caseSensitive,
        wordMatch: nextModifiers.wordMatch,
        regex: nextModifiers.regex,
        hidden: true,
      };

      stackRef.current = stack;
      setParts(nextParts);
      setFields(
        nextParts.length === 0 ? [""] : nextParts.map((part) => part.value),
      );
      setSelectedIndex(0);
      const navEntry: SearchNavEntry = {
        parts: nextParts.map((part) => part.value),
        timeRange: nextTime,
        caseSensitive: nextModifiers.caseSensitive,
        wordMatch: nextModifiers.wordMatch,
        regex: nextModifiers.regex,
      };
      if (!skipNavRef.current) {
        setNav((cur) => pushSearchNav(cur.stack, cur.index, navEntry));
      }
      skipNavRef.current = false;
      setSearchHistory((prev) => pushSearchHistory(prev, navEntry));
      runSearch(
        toRequest(
          stack,
          extraInclude,
          nextTime !== null ? mtimeAfterMs(nextTime) : undefined,
        ),
      );
    },
    [
      excludeGlobs,
      includeGlobs,
      modifiers,
      picks,
      runSearch,
      scope,
      timeRange,
    ],
  );

  const submit = useCallback(
    (nextScope: "all" | "include" | "exclude" = scope) => {
      const parsed = partsFromFields(fields);
      const fallback = stackRef.current?.parts ?? parts;
      searchWithParts(parsed.length > 0 ? parsed : fallback, nextScope);
    },
    [fields, parts, scope, searchWithParts],
  );

  const searchSelected = useCallback(
    (text: string) => {
      const nextScope =
        picks.length > 0 && scope !== "exclude" ? "include" : scope;
      searchWithParts([newPart(text)], nextScope, [], modifiers);
    },
    [modifiers, picks.length, scope, searchWithParts],
  );

  const clearAll = useCallback(() => {
    resetSearch();
    stackRef.current = null;
    pendingSelect.current = null;
    setShareOpen(false);
    setContextOpen(false);
    setParts([]);
    setFields([""]);
    setSelectedIndex(0);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    queryRef.current?.focus();
  }, [resetSearch]);

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    if (token.hostForbidden || token.promptOpen || token.meta === null) {
      return;
    }
    bootstrapped.current = true;
    const parsed = parseShareSearch(window.location.search);
    if (parsed === null) {
      return;
    }
    const nextMods = {
      caseSensitive: parsed.caseSensitive,
      wordMatch: parsed.wordMatch,
      regex: parsed.regex,
    };
    const nextInclude = parsed.includeGlobs ?? "";
    const nextExclude = parsed.excludeGlobs ?? "";
    const nextPicks = parsed.picks ?? [];
    const nextScope =
      parsed.scope === "exclude"
        ? "exclude"
        : nextPicks.length > 0
          ? "include"
          : "all";
    setModifiers(nextMods);
    setIncludeGlobs(nextInclude);
    setExcludeGlobs(nextExclude);
    setPicks(nextPicks);
    setScope(nextScope);
    if (parsed.path !== undefined && parsed.line !== undefined) {
      pendingSelect.current = { path: parsed.path, line: parsed.line };
    }
    if (parsed.timeRange !== undefined) {
      setTimeRange(parsed.timeRange);
      saveTimeRange(parsed.timeRange);
    } else {
      setTimeRange(null);
    }
    const extraInclude =
      nextPicks.length === 0 && parsed.path !== undefined && parsed.path !== ""
        ? [parsed.path]
        : [];
    searchWithParts(
      parsed.parts.map((value) => newPart(value)),
      nextScope,
      extraInclude,
      nextMods,
      parsed.timeRange ?? null,
      nextPicks,
      nextInclude,
      nextExclude,
    );
  }, [searchWithParts, token.hostForbidden, token.meta, token.promptOpen]);

  useEffect(() => {
    if (!bootstrapped.current || shareState === null) {
      return;
    }
    const next = shareUrlSearch(window.location.href, shareState);
    if (window.location.search !== next) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${next}`,
      );
    }
  }, [shareState]);

  useEffect(() => {
    const target = pendingSelect.current;
    if (target === null || search.hits.length === 0) {
      return;
    }
    const idx = search.hits.findIndex(
      (hit) => hit.path === target.path && hit.line === target.line,
    );
    if (idx >= 0) {
      setSelectedIndex(idx);
    }
    if (search.status === "done" || search.status === "error") {
      pendingSelect.current = null;
    }
  }, [search.hits, search.status]);

  const copySelectedPath = useCallback(() => {
    const path = selectedHit?.path;
    if (path === undefined) {
      return;
    }
    void copyText(path);
    setToastMsg(`${t("copiedPath")}: ${path}`);
  }, [selectedHit?.path, t]);

  useHotkeys({
    onSearch: submit,
    onCancel: cancelSearch,
    onCopyPath: copySelectedPath,
    onToggleHelp: () => {
      setHelpOpen((open) => !open);
    },
    running: search.status === "running",
    modalOpen:
      helpOpen ||
      shareOpen ||
      contextOpen ||
      (token.promptOpen && !token.hostForbidden),
    queryRef,
    listRef,
    previewRef,
    hitCount: search.hits.length,
    setSelectedIndex,
  });

  return (
    <div className="app">
      <FileTree
        open={treeOpen}
        onToggle={toggleTree}
        rootLabel={token.meta?.rootLabel ?? t("treeTitle")}
        activePath={selectedHit?.path ?? null}
        picks={picks}
        scope={scope}
        style={
          treeOpen
            ? { flex: `0 0 ${treeWidth}px`, width: `${treeWidth}px` }
            : {
                flex: `0 0 ${TREE_RAIL_WIDTH}px`,
                width: `${TREE_RAIL_WIDTH}px`,
              }
        }
        onTogglePick={(entry, listedChildren, coveringChildren) => {
          const next = togglePick(
            picks,
            {
              path: entry.path,
              dir: entry.dir,
            },
            listedChildren,
            coveringChildren,
          );
          setPicks(next);
          if (next.length === 0) {
            setScope("all");
          } else if (picks.length === 0) {
            setScope("include");
          }
        }}
        onSearchIn={() => {
          setScope("include");
          submit("include");
        }}
        onSearchOut={() => {
          setScope("exclude");
          submit("exclude");
        }}
        onClear={() => {
          setPicks([]);
          setScope("all");
          if (stackRef.current !== null) {
            stackRef.current = {
              ...stackRef.current,
              globInclude: [],
              globAnd: [],
              globExclude: [],
            };
          }
        }}
        sessionReady={token.sessionReady}
        canLogout={token.canLogout}
        searchCount={Math.max(
          search.searchCount,
          token.meta?.searchCount ?? 0,
        )}
        timeRange={timeRange}
        onTimeRange={(next) => {
          setPicks([]);
          setScope("all");
          if (stackRef.current !== null) {
            stackRef.current = {
              ...stackRef.current,
              globInclude: [],
              globAnd: [],
              globExclude: [],
            };
          }
          setTimeRange(next);
          saveTimeRange(next);
          const nextParts = partsFromFields(fields);
          if (nextParts.length > 0) {
            searchWithParts(nextParts, "all", [], modifiers, next, []);
          }
        }}
        onLogout={() => {
          void token.logout().then(() => {
            resetSearch();
            stackRef.current = null;
            setParts([]);
            setFields([""]);
            setSelectedIndex(0);
            setPicks([]);
            setScope("all");
          });
        }}
        {...(token.handleAuthFailure !== undefined
          ? { onAuthFailure: token.handleAuthFailure }
          : {})}
      />
      {treeOpen ? (
        <div
          className="splitter"
          onMouseDown={startResizeTree}
          title="拖拽调整文件树宽度"
        />
      ) : null}
      <section
        className="hits-pane"
        style={{ flex: `0 0 ${hitsWidth}px`, width: `${hitsWidth}px` }}
      >
        <SearchBar
          fields={fields}
          onFieldsChange={setFields}
          onFlushSearch={searchWithParts}
          canClear={
            parts.length > 0 ||
            fields.some((value) => value !== "") ||
            search.hits.length > 0 ||
            search.status !== "idle"
          }
          onClear={clearAll}
          queryRef={queryRef}
          modifiers={modifiers}
          onModifiersChange={(next) => {
            setModifiers(next);
            const nextParts = partsFromFields(fields);
            if (nextParts.length > 0) {
              searchWithParts(nextParts, scope, [], next);
            }
          }}
          includeGlobs={includeGlobs}
          onIncludeGlobsChange={setIncludeGlobs}
          excludeGlobs={excludeGlobs}
          onExcludeGlobsChange={setExcludeGlobs}
          timeRange={timeRange}
          history={searchHistory}
          canGoBack={nav.index > 0}
          canGoForward={nav.index >= 0 && nav.index < nav.stack.length - 1}
          onGoBack={() => {
            if (nav.index <= 0) {
              return;
            }
            const nextIndex = nav.index - 1;
            const entry = nav.stack[nextIndex];
            if (entry === undefined) {
              return;
            }
            setNav((cur) => ({ ...cur, index: nextIndex }));
            skipNavRef.current = true;
            const mods = {
              caseSensitive: entry.caseSensitive,
              wordMatch: entry.wordMatch,
              regex: entry.regex,
            };
            setModifiers(mods);
            setTimeRange(entry.timeRange);
            saveTimeRange(entry.timeRange);
            searchWithParts(
              entry.parts.map((value) => newPart(value)),
              scope,
              [],
              mods,
              entry.timeRange,
            );
          }}
          onGoForward={() => {
            if (nav.index < 0 || nav.index >= nav.stack.length - 1) {
              return;
            }
            const nextIndex = nav.index + 1;
            const entry = nav.stack[nextIndex];
            if (entry === undefined) {
              return;
            }
            setNav((cur) => ({ ...cur, index: nextIndex }));
            skipNavRef.current = true;
            const mods = {
              caseSensitive: entry.caseSensitive,
              wordMatch: entry.wordMatch,
              regex: entry.regex,
            };
            setModifiers(mods);
            setTimeRange(entry.timeRange);
            saveTimeRange(entry.timeRange);
            searchWithParts(
              entry.parts.map((value) => newPart(value)),
              scope,
              [],
              mods,
              entry.timeRange,
            );
          }}
          onRestoreHistory={(item: SearchHistoryItem) => {
            const nextParts = item.parts.map((value) => newPart(value));
            setModifiers({
              caseSensitive: item.caseSensitive,
              wordMatch: item.wordMatch,
              regex: item.regex,
            });
            setTimeRange(item.timeRange);
            saveTimeRange(item.timeRange);
            searchWithParts(
              nextParts,
              scope,
              [],
              {
                caseSensitive: item.caseSensitive,
                wordMatch: item.wordMatch,
                regex: item.regex,
              },
              item.timeRange,
            );
          }}
        />
        <div className="pane-head">
          <span>{t("paneHits")}</span>
          <div className="view-mode-toggle">
            <button
              type="button"
              className={viewMode === "grouped" ? "active" : ""}
              title={t("viewGrouped")}
              onClick={() => {
                setViewMode("grouped");
                localStorage.setItem("web-grep.viewMode", "grouped");
              }}
            >
              <IconListGroup />
            </button>
            <button
              type="button"
              className={viewMode === "flat" ? "active" : ""}
              title={t("viewFlat")}
              onClick={() => {
                setViewMode("flat");
                localStorage.setItem("web-grep.viewMode", "flat");
              }}
            >
              <IconListFlat />
            </button>
          </div>
          <StatusBar
            status={search.status}
            done={search.done}
            progress={search.progress}
            error={search.error}
            hostForbidden={token.hostForbidden}
            meta={token.meta}
            onCancel={cancelSearch}
          />
        </div>
        {search.hits.length === 0 ? (
          <EmptyState
            status={search.status}
            hitCount={search.hits.length}
            done={search.done}
            error={search.error}
            hostForbidden={token.hostForbidden}
          />
        ) : (
          <ResultList
            hits={search.hits}
            selectedIndex={selectedIndexClamped}
            onSelect={selectHit}
            listRef={listRef}
            viewMode={viewMode}
            terms={hlTerms}
            opts={hlOpts}
          />
        )}
      </section>
      <div
        className="splitter"
        onMouseDown={startResizeHits}
        title="拖拽调整结果栏宽度"
      />
      <aside
        className="preview-pane"
        ref={previewRef}
        tabIndex={-1}
        aria-hidden={selectedHit === null}
      >
        <FilePreview
          hit={selectedHit}
          terms={hlTerms}
          opts={hlOpts}
          {...(webUrl !== null || rgCommand !== null
            ? { onShare: () => setShareOpen(true) }
            : {})}
          onOpenContext={() => {
            setContextOpen(true);
          }}
          onSearchSelected={searchSelected}
          onCopyNotice={(txt) => {
            setToastMsg(txt);
          }}
        />
      </aside>
      {token.promptOpen && !token.hostForbidden ? (
        <AuthDialog onLogin={token.login} />
      ) : null}
      <HotkeyHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ShareModal
        open={shareOpen}
        rgCommand={rgCommand}
        webUrl={webUrl}
        onClose={() => {
          setShareOpen(false);
        }}
        onCopyNotice={(txt) => {
          setToastMsg(txt);
        }}
      />
      <ContextModal
        open={contextOpen}
        hit={selectedHit}
        terms={hlTerms}
        opts={hlOpts}
        onClose={() => {
          setContextOpen(false);
        }}
      />
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
    </div>
  );
}

export function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}
