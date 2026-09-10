import type { SearchRequestInput } from "@web-grep/shared";
import { useCallback, useRef, useState } from "react";
import { EmptyState } from "./components/EmptyState.tsx";
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
  if (raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function AppShell() {
  const token = useToken();
  const search = useSearch({ onAuthFailure: token.handleAuthFailure });
  const queryRef = useRef<HTMLInputElement>(null);
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

  useHotkeys({
    onSearch: submit,
    onCancel: cancelSearch,
    running: search.status === "running",
    queryRef,
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
              selectedIndex={Math.min(
                selectedIndex,
                Math.max(0, search.hits.length - 1),
              )}
              onSelect={setSelectedIndex}
            />
          )}
        </section>
        <aside className="preview-pane" aria-hidden="true" />
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
