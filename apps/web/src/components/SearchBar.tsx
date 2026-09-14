import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchHistoryItem } from "../searchHistory.ts";
import type { QueryPart, SearchModifiers } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import { timeRangeMsgKey, type TimeRange } from "../timeRange.ts";
import { IconCaret, IconNavBack, IconNavForward, IconSearch } from "./icons.tsx";

function QueryChips({
  parts,
  onRemove,
  opAnd,
}: {
  parts: QueryPart[];
  onRemove: (id: string) => void;
  opAnd: string;
}) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={part.id} className="q-token">
          {index > 0 ? <span className="q-op">{opAnd}</span> : null}
          <span className={`q-chip hl-${index % 4}`}>
            <span className="q-chip-text">{part.value}</span>
            <button
              type="button"
              className="q-x"
              aria-label="remove"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(part.id);
              }}
            >
              ×
            </button>
          </span>
        </span>
      ))}
    </>
  );
}

export function SearchBar({
  parts,
  onPartsChange,
  draft,
  onDraftChange,
  onFlushSearch,
  canClear,
  onClear,
  queryRef,
  modifiers,
  onModifiersChange,
  includeGlobs = "",
  onIncludeGlobsChange,
  excludeGlobs = "",
  onExcludeGlobsChange,
  timeRange = null,
  history = [],
  onRestoreHistory,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}: {
  parts: QueryPart[];
  onPartsChange: (parts: QueryPart[]) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onFlushSearch: (nextParts: QueryPart[]) => void;
  canClear: boolean;
  onClear: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
  modifiers?: SearchModifiers;
  onModifiersChange?: (modifiers: SearchModifiers) => void;
  includeGlobs?: string;
  onIncludeGlobsChange?: (value: string) => void;
  excludeGlobs?: string;
  onExcludeGlobsChange?: (value: string) => void;
  timeRange?: TimeRange | null;
  history?: SearchHistoryItem[];
  onRestoreHistory?: (item: SearchHistoryItem) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const extraCount = Math.max(0, parts.length - 1);
  const leadPart = parts[0];

  const sendSearch = (): void => {
    const raw = draft.trim();
    onDraftChange("");
    onFlushSearch(raw !== "" ? [...parts, newPart(raw)] : parts);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    sendSearch();
  };

  const toggleEditor = (): void => {
    setEditorOpen((open) => !open);
  };

  useEffect(() => {
    if (parts.length >= 1 && draft.trim() !== "") {
      setEditorOpen(true);
    }
  }, [draft, parts.length]);

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    queryRef.current?.focus();
    const onDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        !rootRef.current.contains(target)
      ) {
        setEditorOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
    };
  }, [editorOpen]);

  const onQueryKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
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
    if (event.key === "Escape" && editorOpen) {
      event.preventDefault();
      setEditorOpen(false);
      queryRef.current?.focus();
      return;
    }
    if (event.key === "Backspace" && draft === "" && parts.length > 0) {
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
    sendSearch();
  };

  const removePart = (id: string): void => {
    onPartsChange(parts.filter((item) => item.id !== id));
  };

  return (
    <div className="search-container" ref={rootRef}>
      <form
        className={editorOpen ? "search-bar is-open" : "search-bar"}
        onSubmit={handleSubmit}
        noValidate
        role="search"
      >
        <div className="search-nav" role="group" aria-label={t("searchHistory")}>
          <button
            type="button"
            className="search-nav-btn"
            disabled={!canGoBack}
            aria-label={t("searchBack")}
            title={t("searchBack")}
            onClick={onGoBack}
          >
            <IconNavBack />
          </button>
          <button
            type="button"
            className="search-nav-btn"
            disabled={!canGoForward}
            aria-label={t("searchForward")}
            title={t("searchForward")}
            onClick={onGoForward}
          >
            <IconNavForward />
          </button>
        </div>
        <div className="search-field-wrap">
          <div
            className={
              leadPart !== undefined ? "search-field has-chips" : "search-field"
            }
            onClick={() => {
              queryRef.current?.focus();
            }}
          >
            <span className="search-icon">
              <IconSearch />
            </span>
            {leadPart !== undefined ? (
              <div
                className={
                  extraCount > 0
                    ? "search-chips-wrap search-chip-row has-more"
                    : "search-chips-wrap search-chip-row"
                }
              >
                <span className="q-token" data-chip-token="">
                  <span className="q-chip hl-0">
                    <span className="q-chip-text">{leadPart.value}</span>
                    <button
                      type="button"
                      className="q-x"
                      aria-label="remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePart(leadPart.id);
                      }}
                    >
                      ×
                    </button>
                  </span>
                </span>
                {extraCount > 0 ? (
                  <button
                    type="button"
                    className="search-more"
                    aria-label={t("queryMore", { n: extraCount })}
                    title={t("queryExpand")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditorOpen(true);
                    }}
                  >
                    {t("queryMore", { n: extraCount })}
                  </button>
                ) : null}
              </div>
            ) : null}
            <input
              ref={queryRef}
              type="text"
              role="searchbox"
              name="query"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={t("queryPlaceholder")}
              placeholder={parts.length === 0 ? t("queryPlaceholder") : ""}
              value={draft}
              onChange={(event) => {
                onDraftChange(event.target.value);
              }}
              onKeyDown={onQueryKeyDown}
            />
            <span
              className={
                timeRange === null
                  ? "search-time-pill is-off"
                  : "search-time-pill"
              }
              title={t("timeRangeHint")}
            >
              {timeRange === null
                ? t("timeRangeAll")
                : t(timeRangeMsgKey(timeRange))}
            </span>
            <button
              type="button"
              className={editorOpen ? "search-caret is-open" : "search-caret"}
              aria-expanded={editorOpen}
              aria-label={t("queryExpand")}
              title={t("queryExpand")}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleEditor();
              }}
            >
              <IconCaret open={editorOpen} />
            </button>
          </div>
          {editorOpen ? (
            <div
              className="search-dropdown"
              role="dialog"
              aria-label={t("queryExpand")}
            >
              {parts.length > 0 ? (
                <div className="search-editor-block">
                  <div className="search-history-label">{t("queryConditions")}</div>
                  <div className="search-editor-chips">
                    <QueryChips
                      parts={parts}
                      onRemove={removePart}
                      opAnd={t("opAnd")}
                    />
                  </div>
                </div>
              ) : null}
              {history.length > 0 ? (
                <div className="search-history">
                  <div className="search-history-label">{t("searchHistory")}</div>
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="search-history-item"
                      onClick={() => {
                        setEditorOpen(false);
                        onRestoreHistory?.(item);
                      }}
                    >
                      <span className="search-history-q">
                        {item.parts.join(" · ")}
                      </span>
                      <span className="search-history-meta">
                        {item.timeRange === null
                          ? t("timeRangeAll")
                          : t(timeRangeMsgKey(item.timeRange))}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="search-editor-hint">{t("searchHistoryEmpty")}</p>
              )}
            </div>
          ) : null}
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
        </div>
      </form>
      <div className="search-advanced">
        <span className="search-advanced-label">{t("advancedOptions")}</span>
        <button
          type="button"
          className={modifiers?.caseSensitive ? "mod-btn active" : "mod-btn"}
          title={t("caseSensitive")}
          aria-pressed={modifiers?.caseSensitive}
          onClick={() => {
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
          onClick={() => {
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
          onClick={() => {
            onModifiersChange?.({
              caseSensitive: modifiers?.caseSensitive ?? false,
              wordMatch: modifiers?.wordMatch ?? false,
              regex: !modifiers?.regex,
            });
          }}
        >
          .*
        </button>
        <label className="filter-field">
          <span className="filter-label">{t("includeGlobLabel")}</span>
          <input
            type="text"
            className="filter-input"
            placeholder={t("includeGlobs")}
            value={includeGlobs}
            onChange={(event) => onIncludeGlobsChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendSearch();
              }
            }}
          />
        </label>
        <label className="filter-field">
          <span className="filter-label">{t("excludeGlobLabel")}</span>
          <input
            type="text"
            className="filter-input"
            placeholder={t("excludeGlobs")}
            value={excludeGlobs}
            onChange={(event) => onExcludeGlobsChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendSearch();
              }
            }}
          />
        </label>
      </div>
      {editorOpen ? (
        <div
          className="search-drop-backdrop"
          onMouseDown={(event) => {
            event.preventDefault();
            setEditorOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
