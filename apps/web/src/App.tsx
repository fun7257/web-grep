import type { SearchRequestInput } from "@web-grep/shared";
import { useCallback, useRef, useState } from "react";
import { EmptyState } from "./components/EmptyState.tsx";
import { copyRelativePath, FilePreview } from "./components/FilePreview.tsx";
import { ResultList } from "./components/ResultList.tsx";
import { SearchBar } from "./components/SearchBar.tsx";
import {
  SearchOptions,
  type SearchOptionValues,
} from "./components/SearchOptions.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TokenPrompt } from "./components/TokenPrompt.tsx";
import { useHotkeys } from "./hooks/useHotkeys.ts";
import { LocaleProvider } from "./hooks/useLocale.ts";
import { useSearch } from "./hooks/useSearch.ts";
import { useToken } from "./hooks/useToken.ts";

function splitGlobs(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let braceDepth = 0;
  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") {
      out.push(trimmed);
    }
    current = "";
  };
  for (const ch of raw) {
    if (ch === "{") {
      braceDepth += 1;
      current += ch;
      continue;
    }
    if (ch === "}" && braceDepth > 0) {
      braceDepth -= 1;
      current += ch;
      continue;
    }
    if (
      braceDepth === 0 &&
      (ch === "," || ch === " " || ch === "\t" || ch === "\n" || ch === "\r")
    ) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return out;
}

function AppShell() {
  const token = useToken();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptionValues>({
    path: "",
    include: "",
    exclude: "",
    regex: true,
    caseSensitive: true,
    wordMatch: false,
    hidden: false,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const runSearch = search.submit;
  const cancelSearch = search.cancel;
  const selectedIndexClamped =
    search.hits.length === 0
      ? 0
      : Math.min(selectedIndex, search.hits.length - 1);
  const selectedHit = search.hits[selectedIndexClamped] ?? null;

  const submit = useCallback(() => {
    const input: SearchRequestInput = {
      query,
      path: options.path,
      globInclude: splitGlobs(options.include),
      globExclude: splitGlobs(options.exclude),
      regex: options.regex,
      caseSensitive: options.caseSensitive,
      wordMatch: options.wordMatch,
      hidden: options.hidden,
    };
    setSelectedIndex(0);
    runSearch(input);
  }, [options, query, runSearch]);

  const copySelectedPath = useCallback(() => {
    if (selectedHit !== null) {
      copyRelativePath(selectedHit.path);
    }
  }, [selectedHit]);

  useHotkeys({
    onSearch: submit,
    onCancel: cancelSearch,
    onCopyPath: copySelectedPath,
    running: search.status === "running",
    modalOpen: token.promptOpen && !token.hostForbidden,
    queryRef,
    listRef,
    previewRef,
    hitCount: search.hits.length,
    setSelectedIndex,
  });

  return (
    <div className="app">
      <header className="app-header">
        <h1>Web Grep</h1>
        <SearchBar
          query={query}
          onQueryChange={setQuery}
          running={search.status === "running"}
          onSubmit={submit}
          onCancel={cancelSearch}
          queryRef={queryRef}
        />
        <SearchOptions
          values={options}
          onChange={(patch) => {
            setOptions((current) => ({ ...current, ...patch }));
          }}
        />
      </header>
      <div className="split">
        <section className="hits-pane">
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
              onSelect={setSelectedIndex}
              listRef={listRef}
            />
          )}
        </section>
        <aside
          className="preview-pane"
          ref={previewRef}
          tabIndex={-1}
          aria-hidden={selectedHit === null}
        >
          <FilePreview
            hit={selectedHit}
            onAuthFailure={token.handleAuthFailure}
          />
        </aside>
      </div>
      <StatusBar
        status={search.status}
        done={search.done}
        error={search.error}
        hostForbidden={token.hostForbidden}
        meta={token.meta}
      />
      {token.promptOpen && !token.hostForbidden ? (
        <TokenPrompt onSubmit={token.saveToken} />
      ) : null}
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
