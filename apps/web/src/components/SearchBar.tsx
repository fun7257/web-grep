import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchHistoryItem } from "../searchHistory.ts";
import type { QueryPart } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import type { TimeRange } from "../timeRange.ts";
import {
  IconAnd,
  IconHistory,
  IconNavBack,
  IconNavForward,
  IconPlus,
  IconSearch,
  IconX,
} from "./icons.tsx";

const MAX_AND_PARTS = 16;

export function SearchBar({
  fields,
  onFieldsChange,
  onFlushSearch,
  canClear,
  onClear,
  queryRef,
  timeRange: _timeRange = null,
  history = [],
  onRestoreHistory,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  running = false,
  searchLocked = false,
  onCancel,
  onOptionFlush,
}: {
  fields: QueryPart[];
  onFieldsChange: (fields: QueryPart[]) => void;
  onFlushSearch: (nextParts: QueryPart[]) => void;
  canClear: boolean;
  onClear: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
  timeRange?: TimeRange | null;
  history?: SearchHistoryItem[];
  onRestoreHistory?: (item: SearchHistoryItem) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  running?: boolean;
  searchLocked?: boolean;
  onCancel?: () => void;
  onOptionFlush?: () => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<"open" | "add" | null>(null);
  const [andOpen, setAndOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const values = fields.length > 0 ? fields : [newPart("")];
  const extras = values.slice(1);
  const extraCount = extras.filter((part) => part.value.trim() !== "").length;
  const firstEmptyExtra = extras.findIndex((part) => part.value.trim() === "");
  const canAdd =
    values.length < MAX_AND_PARTS &&
    (values[values.length - 1]?.value ?? "").trim() !== "";

  const sendSearch = (): void => {
    if (searchLocked) {
      return;
    }
    const terms = values
      .map((part) => ({ ...part, value: part.value.trim() }))
      .filter((part) => part.value !== "");
    setAndOpen(false);
    setHistOpen(false);
    onFlushSearch(terms);
  };

  const setField = (index: number, value: string): void => {
    onFieldsChange(
      values.map((item, i) => (i === index ? { ...item, value } : item)),
    );
  };

  const setFieldMods = (
    index: number,
    patch: Partial<Pick<QueryPart, "caseSensitive" | "wordMatch" | "regex">>,
  ): void => {
    const next = values.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    onFieldsChange(next);
    if (searchLocked) {
      return;
    }
    const ready = next
      .map((part) => ({ ...part, value: part.value.trim() }))
      .filter((part) => part.value !== "");
    if (ready.length > 0) {
      onFlushSearch(ready);
      onOptionFlush?.();
    }
  };

  const addField = (): void => {
    if (!canAdd) {
      return;
    }
    pendingFocus.current = "add";
    setHistOpen(false);
    setAndOpen(true);
    onFieldsChange([...values, newPart("")]);
  };
  const addFieldRef = useRef(addField);
  addFieldRef.current = addField;

  const toggleAnd = (): void => {
    setHistOpen(false);
    setAndOpen((open) => {
      if (!open) {
        pendingFocus.current = "open";
      }
      return !open;
    });
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
    const mode = pendingFocus.current;
    pendingFocus.current = null;
    const index = mode === "add" ? extras.length - 1 : firstEmptyExtra;
    if (index < 0) {
      return;
    }
    const node = extraRefs.current[index];
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  }, [andOpen, extras.length, firstEmptyExtra]);

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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAndOpen(false);
      setHistOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [andOpen, histOpen]);

  const onQueryKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    index: number,
  ): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const part = values[index];
    if (
      part !== undefined &&
      event.altKey &&
      (event.key === "c" || event.key === "C")
    ) {
      event.preventDefault();
      setFieldMods(index, { caseSensitive: !part.caseSensitive });
      return;
    }
    if (
      part !== undefined &&
      event.altKey &&
      (event.key === "w" || event.key === "W")
    ) {
      event.preventDefault();
      setFieldMods(index, { wordMatch: !part.wordMatch });
      return;
    }
    if (
      part !== undefined &&
      event.altKey &&
      (event.key === "r" || event.key === "R")
    ) {
      event.preventDefault();
      setFieldMods(index, { regex: !part.regex });
      return;
    }
    if (event.key === "Escape" && (andOpen || histOpen)) {
      event.preventDefault();
      event.stopPropagation();
      setAndOpen(false);
      setHistOpen(false);
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
                        {item.parts.map((part) => part.value).join(" | ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="search-history-empty">
                  {t("searchHistoryEmpty")}
                </p>
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
              value={values[0]?.value ?? ""}
              onChange={(event) => {
                setField(0, event.target.value);
              }}
              onKeyDown={(event) => {
                onQueryKeyDown(event, 0);
              }}
            />
            <FieldMods
              part={values[0] ?? newPart("")}
              onToggle={(patch) => {
                setFieldMods(0, patch);
              }}
            />
          </div>
          {andOpen ? (
            <div
              className="search-and-pop search-and-block"
              role="dialog"
              aria-label={t("queryConditions")}
            >
              <div className="search-and-list">
                {extras.map((part, extraIndex) => {
                  const index = extraIndex + 1;
                  return (
                    <div key={part.id} className="search-and-item">
                      <div className="search-and-join" aria-hidden="true">
                        <span className="search-and-line" />
                        <span className="search-and-badge">
                          <IconAnd />
                          {t("opAnd")}
                        </span>
                        <span className="search-and-line" />
                      </div>
                      <div className="search-and-row">
                        <div
                          className="search-and-field"
                          onClick={() => {
                            extraRefs.current[extraIndex]?.focus();
                          }}
                        >
                          <input
                            ref={(node) => {
                              extraRefs.current[extraIndex] = node;
                            }}
                            type="text"
                            aria-label={t("queryAddField")}
                            placeholder={t("queryFilterPlaceholder")}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            value={part.value}
                            onChange={(event) => {
                              setField(index, event.target.value);
                            }}
                            onKeyDown={(event) => {
                              onQueryKeyDown(event, index);
                            }}
                          />
                          {part.value !== "" ? (
                            <button
                              type="button"
                              className="search-and-clear"
                              aria-label={t("queryClear")}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setField(index, "");
                              }}
                            >
                              <IconX />
                            </button>
                          ) : null}
                        </div>
                        <div className="search-and-mods">
                          <FieldMods
                            part={part}
                            onToggle={(patch) => {
                              setFieldMods(index, patch);
                            }}
                          />
                        </div>
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
                    disabled={searchLocked}
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
                <p className="search-and-hint search-and-limit">
                  {t("queryAndLimitHint")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={
            andOpen || extraCount > 0
              ? "search-add-field is-on"
              : "search-add-field"
          }
          aria-label={t("queryConditions")}
          title={t("queryConditions")}
          aria-expanded={andOpen}
          onClick={(event) => {
            event.preventDefault();
            toggleAnd();
          }}
        >
          <IconAnd />
          {extraCount > 0 ? (
            <span className="search-add-count">{extraCount}</span>
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
          <button
            type="button"
            className={running ? "search-go cancel" : "search-go"}
            disabled={searchLocked && !running}
            onClick={running ? onCancel : sendSearch}
          >
            {running ? t("cancel") : t("search")}
          </button>
        </div>
      </form>
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

function FieldMods({
  part,
  onToggle,
}: {
  part: QueryPart;
  onToggle: (
    patch: Partial<Pick<QueryPart, "caseSensitive" | "wordMatch" | "regex">>,
  ) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="search-field-mods">
      <button
        type="button"
        className={part.caseSensitive ? "mod-btn active" : "mod-btn"}
        title={t("caseSensitive")}
        aria-pressed={part.caseSensitive}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle({ caseSensitive: !part.caseSensitive });
        }}
      >
        Aa
      </button>
      <button
        type="button"
        className={part.wordMatch ? "mod-btn active" : "mod-btn"}
        title={t("wordMatch")}
        aria-pressed={part.wordMatch}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle({ wordMatch: !part.wordMatch });
        }}
      >
        \b
      </button>
      <button
        type="button"
        className={part.regex ? "mod-btn active" : "mod-btn"}
        title={t("regex")}
        aria-pressed={part.regex}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle({ regex: !part.regex });
        }}
      >
        .*
      </button>
    </div>
  );
}
