import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchHistoryItem } from "../searchHistory.ts";
import type { QueryPart, SearchModifiers } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import { timeRangeMsgKey, type TimeRange } from "../timeRange.ts";
import {
  IconAnd,
  IconCaret,
  IconHistory,
  IconNavBack,
  IconNavForward,
  IconPlus,
  IconSearch,
  IconX,
} from "./icons.tsx";

export function SearchBar({
  fields,
  onFieldsChange,
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
  timeRange: _timeRange = null,
  history = [],
  onRestoreHistory,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}: {
  fields: string[];
  onFieldsChange: (fields: string[]) => void;
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
  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef(false);
  const [andOpen, setAndOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const values = fields.length > 0 ? fields : [""];
  const extras = values.slice(1);
  const canAdd = (values[values.length - 1] ?? "").trim() !== "";

  const sendSearch = (): void => {
    const terms = values
      .map((value) => value.trim())
      .filter((value) => value !== "");
    setAndOpen(false);
    setHistOpen(false);
    onFlushSearch(terms.map(newPart));
  };

  const setField = (index: number, value: string): void => {
    onFieldsChange(values.map((item, i) => (i === index ? value : item)));
  };

  const addField = (): void => {
    if (!canAdd) {
      return;
    }
    pendingFocus.current = true;
    setHistOpen(false);
    setAndOpen(true);
    onFieldsChange([...values, ""]);
  };
  const addFieldRef = useRef(addField);
  addFieldRef.current = addField;

  const toggleAnd = (): void => {
    setHistOpen(false);
    setAndOpen((open) => !open);
  };

  const toggleHist = (): void => {
    setAndOpen(false);
    setHistOpen((open) => !open);
  };

  const removeField = (index: number): void => {
    if (values.length <= 1) {
      return;
    }
    const next = values.filter((_, i) => i !== index);
    onFieldsChange(next);
    if (next.length <= 1) {
      setAndOpen(false);
    }
  };

  useEffect(() => {
    if (!andOpen || !pendingFocus.current) {
      return;
    }
    pendingFocus.current = false;
    const node = extraRefs.current[Math.max(0, extras.length - 1)];
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  }, [andOpen, extras.length]);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) {
        return;
      }
      if (event.key !== "Enter" || !event.shiftKey) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (document.querySelector(".token-overlay") !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      addFieldRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!andOpen && !histOpen) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        !rootRef.current.contains(target)
      ) {
        setAndOpen(false);
        setHistOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
    };
  }, [andOpen, histOpen]);

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
    if (event.key === "Escape" && (andOpen || histOpen)) {
      event.preventDefault();
      setAndOpen(false);
      setHistOpen(false);
      queryRef.current?.focus();
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
      return;
    }
    sendSearch();
  };

  return (
    <div className="search-container" ref={rootRef}>
      <form
        className={andOpen || histOpen ? "search-bar is-open" : "search-bar"}
        onSubmit={handleSubmit}
        noValidate
        role="search"
      >
        <div className="search-nav" role="group" aria-label={t("searchBack")}>
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
        <div className="search-history-wrap">
          <button
            type="button"
            className={
              histOpen ? "search-history-btn is-on" : "search-history-btn"
            }
            aria-label={t("searchHistory")}
            title={t("searchHistory")}
            aria-expanded={histOpen}
            onClick={(event) => {
              event.preventDefault();
              toggleHist();
            }}
          >
            <IconHistory />
          </button>
          {histOpen ? (
            <div
              className="search-history-pop"
              role="dialog"
              aria-label={t("searchHistory")}
            >
              <div className="search-history-label">{t("searchHistory")}</div>
              {history.length > 0 ? (
                <div className="search-history-list">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="search-history-item"
                      onClick={() => {
                        setHistOpen(false);
                        onRestoreHistory?.(item);
                      }}
                    >
                      <span className="search-history-q">
                        {item.parts.join(" AND ")}
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
                <p className="search-history-empty">{t("searchHistoryEmpty")}</p>
              )}
            </div>
          ) : null}
        </div>
        <div className="search-field-wrap">
          <div
            className="search-field"
            onClick={() => {
              queryRef.current?.focus();
            }}
          >
            <span className="search-icon">
              <IconSearch />
            </span>
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
              placeholder={t("queryPlaceholder")}
              value={values[0] ?? ""}
              onChange={(event) => {
                setField(0, event.target.value);
              }}
              onKeyDown={onQueryKeyDown}
            />
            <button
              type="button"
              className={andOpen ? "search-caret is-open" : "search-caret"}
              aria-expanded={andOpen}
              aria-label={t("queryConditions")}
              title={t("queryConditions")}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleAnd();
              }}
            >
              <IconCaret open={andOpen} />
            </button>
          </div>
          {andOpen ? (
            <div
              className="search-and-pop"
              role="dialog"
              aria-label={t("queryAddField")}
            >
              <div className="search-and-list">
              {extras.map((value, extraIndex) => {
                const index = extraIndex + 1;
                return (
                  <div key={`and-${index}`} className="search-and-item">
                    <div className="search-and-join" aria-hidden="true">
                      <span className="search-and-line" />
                      <span className="search-and-badge">
                        <IconAnd />
                        {t("opAnd")}
                      </span>
                      <span className="search-and-line" />
                    </div>
                    <div
                      className="search-field is-extra"
                      onClick={() => {
                        extraRefs.current[extraIndex]?.focus();
                      }}
                    >
                      <span className="search-icon">
                        <IconSearch />
                      </span>
                      <input
                        ref={(node) => {
                          extraRefs.current[extraIndex] = node;
                        }}
                        type="text"
                        aria-label={t("queryAddField")}
                        placeholder={t("queryPlaceholder")}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        value={value}
                        onChange={(event) => {
                          setField(index, event.target.value);
                        }}
                        onKeyDown={onQueryKeyDown}
                      />
                      <button
                        type="button"
                        className="search-field-remove"
                        aria-label={t("queryRemoveField")}
                        onClick={() => {
                          removeField(index);
                        }}
                      >
                        <IconX />
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
              <div className="search-and-foot">
                <div className="search-and-actions">
                  <button
                    type="button"
                    className="search-and-more"
                    disabled={!canAdd}
                    onClick={(event) => {
                      event.preventDefault();
                      addField();
                    }}
                  >
                    <IconPlus />
                    {t("queryAddField")}
                  </button>
                  <button
                    type="button"
                    className="search-and-go"
                    onClick={(event) => {
                      event.preventDefault();
                      sendSearch();
                    }}
                  >
                    {t("search")}
                  </button>
                </div>
                <p className="search-and-hint">
                  <kbd className="search-kbd">Shift+Enter</kbd>
                  {t("queryAndHint")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={
            extras.length > 0 ? "search-add-field is-on" : "search-add-field"
          }
          aria-label={t("queryAddField")}
          title={t("queryAddField")}
          aria-expanded={andOpen}
          disabled={!canAdd}
          onClick={(event) => {
            event.preventDefault();
            addField();
          }}
        >
          <IconPlus />
          {extras.length > 0 ? (
            <span className="search-add-count">{extras.length}</span>
          ) : null}
        </button>
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
      {andOpen || histOpen ? (
        <div
          className="search-drop-backdrop"
          onMouseDown={(event) => {
            event.preventDefault();
            setAndOpen(false);
            setHistOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
