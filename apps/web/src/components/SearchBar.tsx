import type { FormEvent, RefObject } from "react";
import { useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import type { QueryPart, SearchModifiers } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import { IconFilter, IconSearch } from "./icons.tsx";

export function SearchBar({
  parts,
  onPartsChange,
  draft,
  onDraftChange,
  running,
  onFlushSearch,
  canClear,
  onClear,
  onCancel,
  queryRef,
  modifiers,
  onModifiersChange,
  includeGlobs = "",
  onIncludeGlobsChange,
  excludeGlobs = "",
  onExcludeGlobsChange,
}: {
  parts: QueryPart[];
  onPartsChange: (parts: QueryPart[]) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  running: boolean;
  onFlushSearch: (nextParts: QueryPart[]) => void;
  canClear: boolean;
  onClear: () => void;
  onCancel: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
  modifiers?: SearchModifiers;
  onModifiersChange?: (modifiers: SearchModifiers) => void;
  includeGlobs?: string;
  onIncludeGlobsChange?: (value: string) => void;
  excludeGlobs?: string;
  onExcludeGlobsChange?: (value: string) => void;
}) {
  const { t } = useLocale();
  const andLock = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const addTerm = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === "" || andLock.current) {
      return;
    }
    andLock.current = true;
    onPartsChange([...parts, newPart(trimmed)]);
    onDraftChange("");
    window.setTimeout(() => {
      andLock.current = false;
    }, 0);
  };

  const sendSearch = (): void => {
    const raw = draft.trim();
    onDraftChange("");
    onFlushSearch(raw !== "" ? [...parts, newPart(raw)] : parts);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    sendSearch();
  };

  return (
    <div className="search-container">
      <form
        className="search-bar"
        onSubmit={handleSubmit}
        noValidate
        role="search"
      >
        <div
          className="search-field"
          onClick={() => {
            queryRef.current?.focus();
          }}
        >
          <span className="search-icon">
            <IconSearch />
          </span>
          {parts.map((part, index) => (
            <span key={part.id} className="q-token">
              {index > 0 ? <span className="q-op">{t("opAnd")}</span> : null}
              <span className="q-chip">
                <span className="q-chip-text">{part.value}</span>
                <button
                  type="button"
                  className="q-x"
                  aria-label="remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPartsChange(parts.filter((item) => item.id !== part.id));
                  }}
                >
                  ×
                </button>
              </span>
            </span>
          ))}
          <input
            ref={queryRef}
            type="search"
            name="query"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={t("queryPlaceholder")}
            placeholder={
              parts.length === 0 ? t("queryPlaceholder") : t("queryAdd")
            }
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (event.altKey && (event.key === "c" || event.key === "C")) {
                event.preventDefault();
                onModifiersChange?.({
                  caseSensitive: !modifiers?.caseSensitive,
                  wordMatch: modifiers?.wordMatch ?? false,
                  regex: modifiers?.regex ?? false,
                });
                return;
              }
              if (event.altKey && (event.key === "w" || event.key === "W")) {
                event.preventDefault();
                onModifiersChange?.({
                  caseSensitive: modifiers?.caseSensitive ?? false,
                  wordMatch: !modifiers?.wordMatch,
                  regex: modifiers?.regex ?? false,
                });
                return;
              }
              if (event.altKey && (event.key === "r" || event.key === "R")) {
                event.preventDefault();
                onModifiersChange?.({
                  caseSensitive: modifiers?.caseSensitive ?? false,
                  wordMatch: modifiers?.wordMatch ?? false,
                  regex: !modifiers?.regex,
                });
                return;
              }
              if (
                event.key === "Backspace" &&
                draft === "" &&
                parts.length > 0
              ) {
                event.preventDefault();
                onPartsChange(parts.slice(0, -1));
                return;
              }
              if (event.key !== "Enter") {
                return;
              }
              if (event.metaKey || event.ctrlKey) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              if (event.shiftKey) {
                addTerm(draft);
                return;
              }
              sendSearch();
            }}
          />
          <div className="search-modifiers">
            <button
              type="button"
              className={
                modifiers?.caseSensitive ? "mod-btn active" : "mod-btn"
              }
              title={t("caseSensitive")}
              aria-pressed={modifiers?.caseSensitive}
              onClick={(e) => {
                e.stopPropagation();
                onModifiersChange?.({
                  caseSensitive: !modifiers?.caseSensitive,
                  wordMatch: modifiers?.wordMatch ?? false,
                  regex: modifiers?.regex ?? false,
                });
              }}
            >
              Aa
            </button>
            <button
              type="button"
              className={modifiers?.wordMatch ? "mod-btn active" : "mod-btn"}
              title={t("wordMatch")}
              aria-pressed={modifiers?.wordMatch}
              onClick={(e) => {
                e.stopPropagation();
                onModifiersChange?.({
                  caseSensitive: modifiers?.caseSensitive ?? false,
                  wordMatch: !modifiers?.wordMatch,
                  regex: modifiers?.regex ?? false,
                });
              }}
            >
              \b
            </button>
            <button
              type="button"
              className={modifiers?.regex ? "mod-btn active" : "mod-btn"}
              title={t("regex")}
              aria-pressed={modifiers?.regex}
              onClick={(e) => {
                e.stopPropagation();
                onModifiersChange?.({
                  caseSensitive: modifiers?.caseSensitive ?? false,
                  wordMatch: modifiers?.wordMatch ?? false,
                  regex: !modifiers?.regex,
                });
              }}
            >
              .*
            </button>
            <button
              type="button"
              className={
                filtersOpen || Boolean(includeGlobs) || Boolean(excludeGlobs)
                  ? "mod-btn active"
                  : "mod-btn"
              }
              title={t("toggleFilters")}
              aria-expanded={filtersOpen}
              onClick={(e) => {
                e.stopPropagation();
                setFiltersOpen(!filtersOpen);
              }}
            >
              <IconFilter />
            </button>
          </div>
          <kbd className="search-kbd">{t("kbdSearch")}</kbd>
        </div>
        <div className="search-actions">
          <button
            type="button"
            className="search-clear"
            disabled={!canClear}
            onClick={onClear}
          >
            {t("queryClear")}
          </button>
          <button type="button" className="search-go" onClick={sendSearch}>
            {t("search")}
          </button>
          <button
            type="button"
            className="search-cancel"
            disabled={!running}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
        </div>
      </form>
      {filtersOpen ? (
        <div className="search-filters-row">
          <input
            type="text"
            className="filter-input"
            placeholder={t("includeGlobs")}
            value={includeGlobs}
            onChange={(e) => onIncludeGlobsChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendSearch();
              }
            }}
          />
          <input
            type="text"
            className="filter-input"
            placeholder={t("excludeGlobs")}
            value={excludeGlobs}
            onChange={(e) => onExcludeGlobsChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendSearch();
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
