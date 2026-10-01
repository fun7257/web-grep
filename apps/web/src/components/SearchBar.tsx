import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HL_TONES } from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchHistoryItem } from "../searchHistory.ts";
import type { QueryPart } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import type { TimeRange } from "../timeRange.ts";
import {
  IconHistory,
  IconNavBack,
  IconNavForward,
  IconPlus,
  IconSearch,
  IconWarn,
  IconX,
} from "./icons.tsx";

/** Stable empty list so an omitted `history` prop does not look new every render. */
const NO_HISTORY: SearchHistoryItem[] = [];

/** Query row plus filter rows. The query occupies part 0, so filters cap at 15. */
const MAX_FILTER_PARTS = 16;
const MAX_FILTER_ROWS = MAX_FILTER_PARTS - 1;

/** Same tone cycle as `spansForQuery`: term index modulo `HL_TONES`. */
function hlTone(index: number): number {
  return index % HL_TONES;
}

export function SearchBar({
  fields,
  onFieldsChange,
  onFlushSearch,
  canClear,
  onClear,
  queryRef,
  history = NO_HISTORY,
  onRestoreHistory,
  onClearHistory,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  running = false,
  searchLocked = false,
  onCancel,
}: {
  fields: QueryPart[];
  onFieldsChange: (fields: QueryPart[]) => void;
  onFlushSearch: (nextParts: QueryPart[]) => void;
  canClear: boolean;
  onClear: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
  history?: SearchHistoryItem[];
  onRestoreHistory?: (item: SearchHistoryItem) => void;
  onClearHistory?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  running?: boolean;
  searchLocked?: boolean;
  onCancel?: () => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [historyHidden, setHistoryHidden] = useState(false);
  const [historySeen, setHistorySeen] = useState(history);
  // Clear all empties storage, but the trail hook still holds the old array
  // until the next search. Hide that stale list until the prop identity changes.
  if (historySeen !== history) {
    setHistorySeen(history);
    if (historyHidden) {
      setHistoryHidden(false);
    }
  }
  const shownHistory = historyHidden ? [] : history;
  const values = fields.length > 0 ? fields : [newPart("")];
  const extras = values.slice(1);
  const canAdd =
    !searchLocked &&
    values.length < MAX_FILTER_PARTS &&
    (values[values.length - 1]?.value ?? "").trim() !== "";

  const sendSearch = (): void => {
    if (searchLocked) {
      return;
    }
    const terms = values
      .map((part) => ({ ...part, value: part.value.trim() }))
      .filter((part) => part.value !== "");
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
    onFieldsChange(
      values.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const addField = (): void => {
    if (!canAdd) {
      return;
    }
    pendingFocus.current = extras.length;
    setHistOpen(false);
    onFieldsChange([...values, newPart("")]);
  };
  const addFieldRef = useRef(addField);
  addFieldRef.current = addField;

  const removeField = (index: number): void => {
    if (values.length <= 1) {
      return;
    }
    onFieldsChange(values.filter((_, i) => i !== index));
  };

  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) {
      return;
    }
    pendingFocus.current = null;
    const node = extraRefs.current[index];
    if (node === null || node === undefined) {
      return;
    }
    node.focus();
    node.scrollIntoView({ block: "nearest" });
  }, [extras.length]);

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
    if (!histOpen) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        !rootRef.current.contains(target)
      ) {
        setHistOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setHistOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [histOpen]);

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
    if (event.key === "Escape" && histOpen) {
      event.preventDefault();
      event.stopPropagation();
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

  const queryValue = values[0]?.value ?? "";

  return (
    <div className="search-container" ref={rootRef}>
      <form
        className={searchLocked ? "search-card is-locked" : "search-card"}
        onSubmit={handleSubmit}
        noValidate
        role="search"
      >
        <div className="search-main">
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
              setHistOpen((open) => !open);
            }}
          >
            <IconHistory />
          </button>
          <span className="search-sep" aria-hidden="true" />
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
              disabled={searchLocked}
              aria-label={t("queryPlaceholder")}
              placeholder={t("queryPlaceholder")}
              value={queryValue}
              onChange={(event) => {
                setField(0, event.target.value);
              }}
              onKeyDown={(event) => {
                onQueryKeyDown(event, 0);
              }}
            />
            {queryValue !== "" ? (
              <button
                type="button"
                className="search-query-clear"
                aria-label={t("queryFieldClear")}
                disabled={searchLocked}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setField(0, "");
                  queryRef.current?.focus();
                }}
              >
                <IconX />
              </button>
            ) : null}
            <FieldMods
              part={values[0] ?? newPart("")}
              disabled={searchLocked}
              onToggle={(patch) => {
                setFieldMods(0, patch);
              }}
            />
          </div>
          <button
            type="button"
            className={running ? "search-go cancel" : "search-go"}
            disabled={searchLocked && !running}
            onClick={running ? onCancel : sendSearch}
          >
            {running ? t("cancel") : t("search")}
            <span className="kbd" aria-hidden="true">
              {running ? "Esc" : "↵"}
            </span>
          </button>
        </div>
        {extras.length > 0 ? (
          <div className="search-filters">
            {extras.map((part, extraIndex) => {
              const index = extraIndex + 1;
              const tone = hlTone(index);
              return (
                <div key={part.id} className="search-filter-row">
                  <span className="search-filter-tag">
                    <span
                      className="hl-dot"
                      data-tone={tone}
                      style={{ backgroundColor: `var(--hl-${tone})` }}
                    />
                    {t("filterLabel")}
                  </span>
                  <div
                    className="search-filter-field"
                    onClick={() => {
                      extraRefs.current[extraIndex]?.focus();
                    }}
                  >
                    <input
                      ref={(node) => {
                        extraRefs.current[extraIndex] = node;
                      }}
                      type="text"
                      disabled={searchLocked}
                      aria-label={t("filterRowLabel", { n: index })}
                      placeholder={t("filterPlaceholder")}
                      title={part.value.trim() !== "" ? part.value : undefined}
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
                    <FieldMods
                      part={part}
                      disabled={searchLocked}
                      onToggle={(patch) => {
                        setFieldMods(index, patch);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="search-field-remove"
                    aria-label={t("filterRemoveRow", { n: index })}
                    disabled={searchLocked}
                    onClick={() => {
                      removeField(index);
                    }}
                  >
                    <IconX />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="search-foot">
          {searchLocked ? (
            <span className="search-locked-note">
              <IconWarn />
              {t("searchLockedNote")}
            </span>
          ) : (
            <>
              <button
                type="button"
                className="search-filter-add"
                disabled={!canAdd}
                aria-label={t("filterAdd")}
                title={t("filterAdd")}
                onClick={(event) => {
                  event.preventDefault();
                  addField();
                }}
              >
                <IconPlus />
                {t("filterAdd")}
              </button>
              <span className="kbd" aria-hidden="true">
                Shift ↵
              </span>
              <span className="search-filter-hint">{t("filterMustMatch")}</span>
            </>
          )}
          <span className="search-foot-sp" />
          {extras.length > 0 ? (
            <span className="search-filter-count">
              {extras.length} / {MAX_FILTER_ROWS}
            </span>
          ) : null}
          <button
            type="button"
            className="search-clear"
            disabled={!canClear}
            onClick={onClear}
          >
            {t("queryClear")}
          </button>
        </div>
        {histOpen ? (
          <div
            className="search-history-pop"
            role="dialog"
            aria-label={t("searchHistory")}
          >
            <div className="search-history-head">
              <span className="search-history-label">{t("searchHistory")}</span>
              <button
                type="button"
                className="search-history-clear"
                onClick={() => {
                  onClearHistory?.();
                  setHistoryHidden(true);
                }}
              >
                {t("searchHistoryClear")}
              </button>
            </div>
            {shownHistory.length > 0 ? (
              <div className="search-history-list">
                {shownHistory.map((item) => (
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
                      {item.parts.map((part, index) => {
                        const tone = hlTone(index);
                        return (
                          <span
                            key={`${item.id}-${index}`}
                            className="search-history-part"
                          >
                            {index > 0 ? (
                              <span
                                className="search-history-plus"
                                aria-hidden="true"
                              >
                                +
                              </span>
                            ) : null}
                            <span
                              className="hl-dot"
                              data-tone={tone}
                              style={{ backgroundColor: `var(--hl-${tone})` }}
                            />
                            <span className="search-history-term">
                              {part.value}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                    <HistoryMeta item={item} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="search-history-empty">{t("searchHistoryEmpty")}</p>
            )}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function HistoryMeta({ item }: { item: SearchHistoryItem }) {
  const { t } = useLocale();
  const caseOn = item.parts.some((part) => part.caseSensitive);
  const wordOn = item.parts.some((part) => part.wordMatch);
  const regexOn = item.parts.some((part) => part.regex);
  const filterCount = Math.max(0, item.parts.length - 1);
  const tags: string[] = [];
  if (caseOn) {
    tags.push("Aa");
  }
  if (wordOn) {
    tags.push(t("historyWord"));
  }
  if (regexOn) {
    tags.push(".*");
  }
  if (filterCount === 1) {
    tags.push(t("searchHistoryFilterOne"));
  } else if (filterCount > 1) {
    tags.push(t("searchHistoryFilters", { n: filterCount }));
  }
  if (item.timeRange !== null) {
    tags.push(timeLabel(item.timeRange, t));
  }
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="search-history-meta">
      {tags.map((tag) => (
        <span key={tag} className="search-history-tag">
          {tag}
        </span>
      ))}
    </span>
  );
}

function timeLabel(
  range: TimeRange,
  t: (key: "timeRangeToday" | "timeRange24h" | "timeRange7d") => string,
): string {
  if (range === "today") {
    return t("timeRangeToday");
  }
  if (range === "24h") {
    return t("timeRange24h");
  }
  return t("timeRange7d");
}

function FieldMods({
  part,
  disabled = false,
  onToggle,
}: {
  part: QueryPart;
  disabled?: boolean;
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
        disabled={disabled}
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
        disabled={disabled}
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
        disabled={disabled}
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
