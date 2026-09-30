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
import { InfoCue, StatusBar, WarnBanners } from "./components/StatusBar.tsx";
import { Toast } from "./components/Toast.tsx";
import { AuthDialog } from "./components/AuthDialog.tsx";
import { useHotkeys } from "./hooks/useHotkeys.ts";
import { LocaleProvider, useLocale } from "./hooks/useLocale.ts";
import { useResizablePanes } from "./hooks/useResizablePanes.ts";
import { useSearch } from "./hooks/useSearch.ts";
import { useSearchSession } from "./hooks/useSearchSession.ts";
import { useSearchTrail } from "./hooks/useSearchTrail.ts";
import { useShareLink } from "./hooks/useShareLink.ts";
import { copyText } from "./copyText.ts";
import { parseGlobs } from "./globs.ts";
import type { HlTermInput } from "./highlight.ts";
import { resolvePreviewChunk } from "./previewChunk.ts";
import { useAuth } from "./hooks/useAuth.ts";
import { useBatchedHits } from "./hooks/useBatchedHits.ts";
import type { SearchNavEntry } from "./searchNav.ts";
import {
  buildShareUrl,
  captureShareState,
  type ShareState,
} from "./searchShare.ts";
import { buildRgShareCommand } from "./shareCommand.ts";
import { newPart } from "./searchStack.ts";
import {
  loadTimeRange,
  saveTimeRange,
  type TimeRange,
} from "./timeRange.ts";
import {
  prunePicksByExclude,
  removePick,
  type TreePick,
  togglePick,
} from "./treePicks.ts";

const EMPTY_HL_TERMS: HlTermInput[] = [];

function AppShell() {
  const { t } = useLocale();
  const token = useAuth();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [treeOpen, toggleTree] = useTreeOpen();
  const [picks, setPicks] = useState<TreePick[]>([]);
  const [excludeGlobs, setExcludeGlobs] = useState("");

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [infoCue, setInfoCue] = useState<string | null>(null);
  const infoCueTimer = useRef(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(
    null,
  );
  const [timeRange, setTimeRange] = useState<TimeRange | null>(loadTimeRange);
  const [hitsHeadActions, setHitsHeadActions] = useState<HTMLDivElement | null>(
    null,
  );

  const { treeWidth, hitsWidth, startResizeTree, startResizeHits } =
    useResizablePanes();

  const runSearch = search.submit;
  const cancelSearch = search.cancel;
  const resetSearch = search.reset;
  const listHits = useBatchedHits(search.hits, search.status);
  const selectedIndexClamped =
    search.hits.length === 0
      ? 0
      : Math.min(selectedIndex, search.hits.length - 1);
  const selectedHit = search.hits[selectedIndexClamped] ?? null;

  const selectHit = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);
  const resetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, []);

  const showInfoCue = useCallback((message: string) => {
    window.clearTimeout(infoCueTimer.current);
    setInfoCue(message);
    infoCueTimer.current = window.setTimeout(() => {
      setInfoCue(null);
    }, 2800);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(infoCueTimer.current);
    };
  }, []);

  const engineDown =
    token.meta?.engine === "none" || search.error?.code === "ENGINE";
  const searchLocked = token.hostForbidden || engineDown;
  const authOpen = token.promptOpen && !token.hostForbidden;

  const trail = useSearchTrail();
  const session = useSearchSession({
    timeRange,
    picks,
    excludeGlobs,
    runSearch,
    record: trail.record,
    showInfoCue,
    onStart: resetSelection,
    searchLocked,
  });
  const {
    fields,
    setFields,
    lastStack,
    setLastStack,
    searchWithParts,
    submit,
    searchSelected,
    resetDraft,
  } = session;

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
  const rgCommand =
    shareState !== null && selectedHit !== null
      ? buildRgShareCommand({
          state: shareState,
          hit: selectedHit,
          rootAbs: token.meta?.root,
          hidden: lastStack?.hidden ?? true,
        })
      : null;

  const restoreShare = useCallback(
    (parsed: ShareState) => {
      setExcludeGlobs(parsed.excludeGlobs ?? "");
      setPicks(parsed.picks ?? []);
      showInfoCue(t("shareRestored"));
      if (parsed.timeRange !== undefined) {
        setTimeRange(parsed.timeRange);
        saveTimeRange(parsed.timeRange);
      } else {
        setTimeRange(null);
      }
      const nextFields = parsed.parts.map((value, index) =>
        newPart(value, parsed.mods?.[index]),
      );
      setFields(nextFields.length > 0 ? nextFields : [newPart("")]);
    },
    [setFields, showInfoCue, t],
  );
  const { sharePending, dropPendingSelect } = useShareLink({
    ready: !token.hostForbidden && !token.promptOpen && token.meta !== null,
    onRestore: restoreShare,
    shareState,
    hits: search.hits,
    status: search.status,
    onSelectIndex: setSelectedIndex,
  });

  /** Put a nav or history entry back into the scope and search it again. */
  const replayEntry = useCallback(
    (entry: SearchNavEntry) => {
      setTimeRange(entry.timeRange);
      saveTimeRange(entry.timeRange);
      searchWithParts(
        entry.parts.map((part) => newPart(part.value, part)),
        [],
        entry.timeRange,
      );
    },
    [searchWithParts],
  );

  const clearAll = useCallback(() => {
    resetSearch();
    resetDraft();
    dropPendingSelect();
    setInfoCue(null);
    setShareOpen(false);
    setContextTarget(null);
    setSelectedIndex(0);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    queryRef.current?.focus();
  }, [dropPendingSelect, resetDraft, resetSearch]);

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
    <div
      className={
        authOpen || contextTarget !== null ? "app app-dimmed" : "app"
      }
    >
      <FileTree
        open={treeOpen}
        onToggle={toggleTree}
        rootLabel={token.meta?.rootLabel ?? t("treeTitle")}
        activePath={selectedHit?.path ?? null}
        picks={picks}
        style={
          treeOpen
            ? { flex: `0 0 ${treeWidth}px`, width: `${treeWidth}px` }
            : {
                flex: `0 0 ${TREE_RAIL_WIDTH}px`,
                width: `${TREE_RAIL_WIDTH}px`,
              }
        }
        onTogglePick={(entry, listedChildren, coveringChildren, truncated) => {
          const next = togglePick(
            picks,
            {
              path: entry.path,
              dir: entry.dir,
            },
            listedChildren,
            coveringChildren,
            truncated,
          );
          setPicks(next);
        }}
        onOpenFile={(path) => {
          setContextTarget({ path, allowGotoLine: true });
        }}
        onRemovePick={(pick) => {
          setPicks((current) => removePick(current, pick.path));
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
          setLastStack((cur) =>
            cur === null ? cur : { ...cur, globInclude: [], globIntersect: [] },
          );
          setTimeRange(next);
          saveTimeRange(next);
        }}
        onLogout={() => {
          void token.logout().then(() => {
            resetSearch();
            resetDraft();
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
            lastStack !== null ||
            fields.some((part) => part.value !== "") ||
            search.hits.length > 0 ||
            search.status !== "idle"
          }
          onClear={clearAll}
          queryRef={queryRef}
          history={trail.history}
          canGoBack={trail.canGoBack}
          canGoForward={trail.canGoForward}
          onGoBack={() => {
            const entry = trail.step(-1);
            if (entry !== null) {
              replayEntry(entry);
            }
          }}
          onGoForward={() => {
            const entry = trail.step(1);
            if (entry !== null) {
              replayEntry(entry);
            }
          }}
          onRestoreHistory={replayEntry}
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
        <InfoCue message={infoCue} />
        <InfoCue
          message={
            sharePending !== null
              ? t("sharePendingSelect", {
                  path: sharePending.path,
                  line: sharePending.line,
                })
              : null
          }
        />
        <WarnBanners done={search.done} />
        {listHits.length === 0 ? (
          <EmptyState
            status={search.status}
            hitCount={search.hits.length}
            done={search.done}
            error={search.error}
            hostForbidden={token.hostForbidden}
            engine={token.meta?.engine ?? null}
            treeCollapsed={!treeOpen}
          />
        ) : (
          <ResultList
            hits={listHits}
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
        aria-hidden={selectedHit === null}
      >
        <FilePreview
          hit={selectedHit}
          pendingSelect={sharePending}
          terms={hlTerms}
          opts={hlOpts}
          {...(webUrl !== null || rgCommand !== null
            ? { onShare: () => setShareOpen(true) }
            : {})}
          onOpenContext={() => {
            if (selectedHit !== null) {
              setContextTarget({
                path: selectedHit.path,
                highlightLine: selectedHit.line,
                matches: selectedHit.matches,
                allowGotoLine: true,
              });
            }
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
        previewChunk={
          token.meta === null
            ? null
            : resolvePreviewChunk(token.meta.limits)
        }
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
