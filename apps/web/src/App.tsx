import { useCallback, useEffect, useRef, useState } from "react";
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
import { TokenPrompt } from "./components/TokenPrompt.tsx";
import { useHotkeys } from "./hooks/useHotkeys.ts";
import { LocaleProvider, useLocale } from "./hooks/useLocale.ts";
import { useResizablePanes } from "./hooks/useResizablePanes.ts";
import { useSearch } from "./hooks/useSearch.ts";
import { useToken } from "./hooks/useToken.ts";
import { buildShareUrl, parseShareSearch } from "./searchShare.ts";
import {
  compileParts,
  joinAbs,
  newPart,
  type QueryPart,
  type SearchModifiers,
  type SearchStack,
  toRequest,
  toRgShareCommand,
} from "./searchStack.ts";
import { picksToGlobs, type TreePick, togglePick } from "./treePicks.ts";

function parseGlobs(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function AppShell() {
  const { t } = useLocale();
  const token = useToken();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [parts, setParts] = useState<QueryPart[]>([]);
  const [draft, setDraft] = useState("");
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
  const hlTerms = lastStack?.parts.map((part) => part.value) ?? [];
  const hlOpts = {
    caseSensitive: lastStack?.caseSensitive ?? false,
    wordMatch: lastStack?.wordMatch ?? false,
    regex: lastStack?.regex ?? false,
  };
  const rootAbs = token.meta?.root;
  const webUrl =
    selectedHit !== null && lastStack !== null && lastStack.parts.length > 0
      ? buildShareUrl(window.location.href, {
          parts: lastStack.parts.map((part) => part.value),
          caseSensitive: lastStack.caseSensitive,
          wordMatch: lastStack.wordMatch,
          regex: lastStack.regex,
          path: selectedHit.path,
          line: selectedHit.line,
        })
      : null;
  let rgCommand: string | null = null;
  if (
    selectedHit !== null &&
    lastStack !== null &&
    rootAbs !== undefined &&
    rootAbs !== ""
  ) {
    const compiled = compileParts(lastStack.parts, lastStack.regex);
    if (compiled.query !== "") {
      rgCommand = toRgShareCommand({
        query: compiled.query,
        regex: lastStack.regex || compiled.regex,
        caseSensitive: lastStack.caseSensitive,
        wordMatch: lastStack.wordMatch,
        hidden: lastStack.hidden,
        absPath: joinAbs(rootAbs, selectedHit.path),
        line: selectedHit.line,
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
    ) => {
      if (nextParts.length === 0) {
        return;
      }
      const compiled = compileParts(nextParts, nextModifiers.regex);
      if (compiled.query === "") {
        return;
      }
      const globs = picksToGlobs(picks);
      let effective: "all" | "include" | "exclude" = "all";
      if (picks.length > 0) {
        if (nextScope === "exclude") {
          effective = "exclude";
        } else if (nextScope === "include") {
          effective = "include";
        } else {
          effective = scope === "exclude" ? "exclude" : "include";
        }
      }

      const manualIncludes = parseGlobs(includeGlobs);
      const manualExcludes = parseGlobs(excludeGlobs);

      const prev = stackRef.current;
      const baseIncludes =
        extraInclude.length > 0
          ? extraInclude
          : effective === "include"
            ? [...globs, ...manualIncludes]
            : manualIncludes.length > 0
              ? manualIncludes
              : (prev?.globInclude ?? []);

      const baseExcludes =
        extraInclude.length > 0
          ? []
          : effective === "exclude"
            ? [...globs, ...manualExcludes]
            : manualExcludes.length > 0
              ? manualExcludes
              : (prev?.globExclude ?? []);

      const stack: SearchStack = {
        parts: nextParts,
        globInclude: baseIncludes,
        globExclude: baseExcludes,
        path: "",
        caseSensitive: nextModifiers.caseSensitive,
        wordMatch: nextModifiers.wordMatch,
        regex: nextModifiers.regex,
        hidden: true,
      };

      if (
        extraInclude.length === 0 &&
        effective === "all" &&
        manualIncludes.length === 0 &&
        manualExcludes.length === 0 &&
        prev
      ) {
        stack.globInclude = prev.globInclude;
        stack.globExclude = prev.globExclude;
      }

      stackRef.current = stack;
      setParts(nextParts);
      setDraft("");
      setSelectedIndex(0);
      runSearch(toRequest(stack, extraInclude));
    },
    [excludeGlobs, includeGlobs, modifiers, picks, runSearch, scope],
  );

  const submit = useCallback(
    (nextScope: "all" | "include" | "exclude" = scope) => {
      const raw = draft.trim();
      searchWithParts(
        raw !== "" ? [...parts, newPart(raw)] : parts,
        nextScope,
        [],
        modifiers,
      );
    },
    [draft, modifiers, parts, scope, searchWithParts],
  );

  const searchSelected = useCallback(
    (text: string) => {
      searchWithParts([newPart(text)], scope, [], modifiers);
    },
    [modifiers, scope, searchWithParts],
  );

  const clearAll = useCallback(() => {
    resetSearch();
    stackRef.current = null;
    pendingSelect.current = null;
    setShareOpen(false);
    setParts([]);
    setDraft("");
    setSelectedIndex(0);
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
    setModifiers(nextMods);
    if (parsed.path !== undefined && parsed.line !== undefined) {
      pendingSelect.current = { path: parsed.path, line: parsed.line };
    }
    searchWithParts(
      parsed.parts.map((value) => newPart(value)),
      "all",
      [],
      nextMods,
    );
  }, [searchWithParts, token.hostForbidden, token.meta, token.promptOpen]);

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
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      return;
    }
    void clipboard.writeText(path);
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
      helpOpen || shareOpen || (token.promptOpen && !token.hostForbidden),
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
        onTogglePick={(entry) => {
          const next = togglePick(picks, {
            path: entry.path,
            dir: entry.dir,
          });
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
          parts={parts}
          onPartsChange={setParts}
          draft={draft}
          onDraftChange={setDraft}
          running={search.status === "running"}
          onFlushSearch={searchWithParts}
          canClear={
            parts.length > 0 ||
            draft !== "" ||
            search.hits.length > 0 ||
            search.status !== "idle"
          }
          onClear={clearAll}
          onCancel={cancelSearch}
          queryRef={queryRef}
          modifiers={modifiers}
          onModifiersChange={(next) => {
            setModifiers(next);
            if (parts.length > 0 || draft.trim() !== "") {
              const raw = draft.trim();
              searchWithParts(
                raw !== "" ? [...parts, newPart(raw)] : parts,
                scope,
                [],
                next,
              );
            }
          }}
          includeGlobs={includeGlobs}
          onIncludeGlobsChange={setIncludeGlobs}
          excludeGlobs={excludeGlobs}
          onExcludeGlobsChange={setExcludeGlobs}
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
        {selectedHit === null ? (
          <div className="pane-head">
            <span>{t("panePreview")}</span>
          </div>
        ) : null}
        <FilePreview
          hit={selectedHit}
          terms={hlTerms}
          opts={hlOpts}
          {...(webUrl !== null || rgCommand !== null
            ? { onShare: () => setShareOpen(true) }
            : {})}
          onSearchSelected={searchSelected}
          onCopyNotice={(txt) => {
            setToastMsg(txt);
          }}
        />
      </aside>
      {token.promptOpen && !token.hostForbidden ? (
        <TokenPrompt onSubmit={token.saveToken} />
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
