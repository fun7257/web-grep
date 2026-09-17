import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContextModal,
  type ContextTarget,
} from "./components/ContextModal.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { FilePreview } from "./components/FilePreview.tsx";
import {
  FileTree,
  TREE_RAIL_WIDTH,
  useTreeOpen,
} from "./components/FileTree.tsx";
import { HotkeyHelpModal } from "./components/HotkeyHelpModal.tsx";

import { ResultList } from "./components/ResultList.tsx";
import { SearchBar } from "./components/SearchBar.tsx";
import { ShareModal } from "./components/ShareModal.tsx";
import { StatusBar, WarnBanners } from "./components/StatusBar.tsx";
import { Toast } from "./components/Toast.tsx";
import { AuthDialog } from "./components/AuthDialog.tsx";
import { useHotkeys } from "./hooks/useHotkeys.ts";
import { LocaleProvider, useLocale } from "./hooks/useLocale.ts";
import { useResizablePanes } from "./hooks/useResizablePanes.ts";
import { useSearch } from "./hooks/useSearch.ts";
import { copyText } from "./copyText.ts";
import { parseGlobs } from "./globs.ts";
import type { HlTermInput } from "./highlight.ts";
import { useAuth } from "./hooks/useAuth.ts";
import {
  buildShareUrl,
  captureShareState,
  parseShareSearch,
  shareUrlSearch,
} from "./searchShare.ts";
import {
  picksToSearchGlobs,
  prunePicksByExclude,
  type TreePick,
  togglePick,
} from "./treePicks.ts";
import {
  newPart,
  type QueryPart,
  type SearchStack,
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

const EMPTY_HL_TERMS: HlTermInput[] = [];

function partsFromFields(values: QueryPart[]): QueryPart[] {
  return values
    .map((part) => ({ ...part, value: part.value.trim() }))
    .filter((part) => part.value !== "");
}

function AppShell() {
  const { t } = useLocale();
  const token = useAuth();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [parts, setParts] = useState<QueryPart[]>([]);
  const [fields, setFields] = useState<QueryPart[]>(() => [newPart("")]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [treeOpen, toggleTree] = useTreeOpen();
  const [picks, setPicks] = useState<TreePick[]>([]);
  const [excludeGlobs, setExcludeGlobs] = useState("");

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseEpoch, setBrowseEpoch] = useState(0);
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
  const [hitsHeadActions, setHitsHeadActions] = useState<HTMLDivElement | null>(
    null,
  );

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
    () =>
      lastStack?.parts.map((part) => ({
        value: part.value,
        caseSensitive: part.caseSensitive,
        wordMatch: part.wordMatch,
        regex: part.regex,
      })) ?? EMPTY_HL_TERMS,
    [lastStack],
  );
  const hlOpts = useMemo(
    () => ({
      caseSensitive: lastStack?.parts[0]?.caseSensitive ?? false,
      wordMatch: lastStack?.parts[0]?.wordMatch ?? false,
      regex: lastStack?.parts[0]?.regex ?? false,
    }),
    [lastStack],
  );
  const rootAbs = token.meta?.root;
  const shareState = useMemo(
    () =>
      captureShareState({
        fields,
        excludeGlobs,
        picks,
        timeRange,
        ...(lastStack !== null ? { fallbackParts: lastStack.parts } : {}),
        ...(selectedHit !== null
          ? { hitPath: selectedHit.path, hitLine: selectedHit.line }
          : {}),
      }),
    [excludeGlobs, fields, lastStack, picks, selectedHit, timeRange],
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
    const query = shareState.parts[0] ?? "";
    if (query !== "") {
      const head = shareState.mods?.[0] ?? {
        caseSensitive: shareState.caseSensitive,
        wordMatch: shareState.wordMatch,
        regex: shareState.regex,
      };
      rgCommand = toRgShareCommand({
        query,
        regex: head.regex,
        caseSensitive: head.caseSensitive,
        wordMatch: head.wordMatch,
        hidden: lastStack?.hidden ?? true,
        rootAbs,
        relPaths: [selectedHit.path],
        andTerms: shareState.parts.slice(1).map((term, index) => {
          const mod = shareState.mods?.[index + 1];
          return {
            query: term,
            regex: mod?.regex ?? false,
            caseSensitive: mod?.caseSensitive ?? false,
            wordMatch: mod?.wordMatch ?? false,
          };
        }),
        line: selectedHit.line,
      });
    }
  }

  const selectHit = useCallback((index: number) => {
    setBrowsePath(null);
    setSelectedIndex(index);
  }, []);

  const engineDown =
    token.meta?.engine === "none" ||
    search.error?.code === "ENGINE" ||
    search.error?.code === "ENGINE_UNSUPPORTED";
  const searchLocked = token.hostForbidden || engineDown;
  const authOpen = token.promptOpen && !token.hostForbidden;

  const searchWithParts = useCallback(
    (
      nextParts: QueryPart[],
      extraInclude: string[] = [],
      nextTime: TimeRange | null = timeRange,
      nextPicks: TreePick[] = picks,
      nextExcludeRaw: string = excludeGlobs,
    ) => {
      const ready = partsFromFields(nextParts);
      if (ready.length === 0) {
        return;
      }
      const globs = picksToSearchGlobs(
        nextPicks,
        extraInclude,
        parseGlobs(nextExcludeRaw),
      );
      const head = ready[0];

      const stack: SearchStack = {
        parts: ready,
        globInclude: globs.globInclude,
        globAnd: [],
        globExclude: globs.globExclude,
        path: "",
        caseSensitive: head?.caseSensitive ?? false,
        wordMatch: head?.wordMatch ?? false,
        regex: head?.regex ?? false,
        hidden: true,
      };

      stackRef.current = stack;
      setParts(ready);
      setFields(ready);
      setSelectedIndex(0);
      const navEntry: SearchNavEntry = {
        parts: ready.map((part) => ({
          value: part.value,
          caseSensitive: part.caseSensitive,
          wordMatch: part.wordMatch,
          regex: part.regex,
        })),
        timeRange: nextTime,
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
    [excludeGlobs, picks, runSearch, timeRange],
  );

  const submit = useCallback(() => {
    const parsed = partsFromFields(fields);
    const fallback = stackRef.current?.parts ?? parts;
    searchWithParts(parsed.length > 0 ? parsed : fallback);
  }, [fields, parts, searchWithParts]);

  const searchSelected = useCallback(
    (text: string) => {
      const current = fields[0];
      searchWithParts([
        newPart(text, {
          caseSensitive: current?.caseSensitive ?? false,
          wordMatch: current?.wordMatch ?? false,
          regex: current?.regex ?? false,
        }),
      ]);
    },
    [fields, searchWithParts],
  );

  const clearAll = useCallback(() => {
    resetSearch();
    stackRef.current = null;
    pendingSelect.current = null;
    setShareOpen(false);
    setContextTarget(null);
    setBrowsePath(null);
    setParts([]);
    setFields([newPart("")]);
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
    const nextExclude = parsed.excludeGlobs ?? "";
    const nextPicks = parsed.picks ?? [];
    setExcludeGlobs(nextExclude);
    setPicks(nextPicks);
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
      parsed.parts.map((value, index) =>
        newPart(value, parsed.mods?.[index]),
      ),
      extraInclude,
      parsed.timeRange ?? null,
      nextPicks,
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
      contextTarget !== null ||
      (token.promptOpen && !token.hostForbidden),
    queryRef,
    listRef,
    previewRef,
    hitCount: search.hits.length,
    setSelectedIndex,
  });

  return (
    <div className={authOpen ? "app app-dimmed" : "app"}>
      <FileTree
        open={treeOpen}
        onToggle={toggleTree}
        rootLabel={token.meta?.rootLabel ?? t("treeTitle")}
        activePath={browsePath ?? selectedHit?.path ?? null}
        picks={picks}
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
        }}
        onOpenFile={(path) => {
          setBrowsePath(path);
          setBrowseEpoch((n) => n + 1);
        }}
        onRemovePick={(pick) => {
          setPicks((current) =>
            current.filter((item) => item.path !== pick.path),
          );
        }}
        onClear={() => {
          setPicks([]);
          setExcludeGlobs("");
          setTimeRange(null);
          saveTimeRange(null);
        }}
        sessionReady={token.sessionReady}
        canLogout={token.canLogout}
        searchCount={Math.max(
          search.searchCount,
          token.meta?.searchCount ?? 0,
        )}
        excludeGlobs={excludeGlobs}
        onExcludeGlobsChange={setExcludeGlobs}
        onExcludeApply={(raw) => {
          setPicks((current) => prunePicksByExclude(current, parseGlobs(raw)));
        }}
        timeRange={timeRange}
        onTimeRange={(next) => {
          setPicks([]);
          if (stackRef.current !== null) {
            stackRef.current = {
              ...stackRef.current,
              globInclude: [],
              globAnd: [],
            };
          }
          setTimeRange(next);
          saveTimeRange(next);
        }}
        onLogout={() => {
          void token.logout().then(() => {
            resetSearch();
            stackRef.current = null;
            setParts([]);
            setFields([newPart("")]);
            setSelectedIndex(0);
            setPicks([]);
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
            fields.some((part) => part.value !== "") ||
            search.hits.length > 0 ||
            search.status !== "idle"
          }
          onClear={clearAll}
          queryRef={queryRef}
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
            setTimeRange(entry.timeRange);
            saveTimeRange(entry.timeRange);
            searchWithParts(
              entry.parts.map((part) => newPart(part.value, part)),
              [],
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
            setTimeRange(entry.timeRange);
            saveTimeRange(entry.timeRange);
            searchWithParts(
              entry.parts.map((part) => newPart(part.value, part)),
              [],
              entry.timeRange,
            );
          }}
          onRestoreHistory={(item: SearchHistoryItem) => {
            setTimeRange(item.timeRange);
            saveTimeRange(item.timeRange);
            searchWithParts(
              item.parts.map((part) => newPart(part.value, part)),
              [],
              item.timeRange,
            );
          }}
          running={search.status === "running"}
          searchLocked={searchLocked}
          onCancel={cancelSearch}
        />
        <div className="pane-head">
          <span className="pane-head-title">
            {search.status === "running" ? t("loading") : t("paneHits")}
          </span>
          <div ref={setHitsHeadActions} className="pane-head-actions" />
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
        <WarnBanners done={search.done} />
        {search.hits.length === 0 ? (
          <EmptyState
            status={search.status}
            hitCount={search.hits.length}
            done={search.done}
            error={search.error}
            hostForbidden={token.hostForbidden}
            engine={token.meta?.engine}
          />
        ) : (
          <ResultList
            hits={search.hits}
            selectedIndex={selectedIndexClamped}
            onSelect={selectHit}
            listRef={listRef}
            terms={hlTerms}
            opts={hlOpts}
            headActions={hitsHeadActions}
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
        aria-hidden={selectedHit === null && browsePath === null}
      >
        <FilePreview
          hit={browsePath !== null ? null : selectedHit}
          browsePath={browsePath}
          browseEpoch={browseEpoch}
          terms={hlTerms}
          opts={hlOpts}
          {...(webUrl !== null || rgCommand !== null
            ? { onShare: () => setShareOpen(true) }
            : {})}
          onOpenContext={() => {
            if (browsePath !== null) {
              setContextTarget({ path: browsePath, allowGotoLine: true });
              return;
            }
            if (selectedHit === null) {
              return;
            }
            setContextTarget({
              path: selectedHit.path,
              highlightLine: selectedHit.line,
              matches: selectedHit.matches,
            });
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
        open={contextTarget !== null}
        target={contextTarget}
        terms={hlTerms}
        opts={hlOpts}
        onClose={() => {
          setContextTarget(null);
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
