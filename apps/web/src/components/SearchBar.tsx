import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { measureFilterPanelWidth } from "../filterPanelLayout.ts";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchHistoryItem } from "../searchHistory.ts";
import type { QueryPart } from "../searchStack.ts";
import { countFilledFilters, newPart } from "../searchStack.ts";
import {
  IconFilter,
  IconHistory,
  IconNavBack,
  IconNavForward,
  IconPlus,
  IconSearch,
  IconX,
} from "./icons.tsx";

const MAX_FILTER_PARTS = 16;

export function SearchBar({
  fields,
  onFieldsChange,
  onFlushSearch,
  canClear,
  onClear,
  queryRef,
  history = [],
  onRestoreHistory,
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const extraRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<"open" | "add" | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const values = fields.length > 0 ? fields : [newPart("")];
  const extras = values.slice(1);
  const extraCount = countFilledFilters(values);
  const firstEmptyExtra = extras.findIndex((part) => part.value.trim() === "");
  const canAdd =
    values.length < MAX_FILTER_PARTS &&
    (values[values.length - 1]?.value ?? "").trim() !== "";

  const sendSearch = (): void => {
    if (searchLocked) {
      return;
    }
    const terms = values
      .map((part) => ({ ...part, value: part.value.trim() }))
      .filter((part) => part.value !== "");
    setFilterPanelOpen(false);
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
    pendingFocus.current = "add";
    setHistOpen(false);
    setFilterPanelOpen(true);
    onFieldsChange([...values, newPart("")]);
  };
  const addFieldRef = useRef(addField);
  addFieldRef.current = addField;

  const toggleAnd = (): void => {
    setHistOpen(false);
    setFilterPanelOpen((open) => {
      if (!open) {
        pendingFocus.current = "open";
      }
      return !open;
    });
  };

  const toggleHist = (): void => {
    setFilterPanelOpen(false);
    setHistOpen((open) => !open);
  };

  const removeField = (index: number): void => {
    if (values.length <= 1) {
      return;
    }
    const next = values.filter((_, i) => i !== index);
    onFieldsChange(next);
    if (next.length <= 1) {
      setFilterPanelOpen(false);
    }
  };

  useLayoutEffect(() => {
    if (!filterPanelOpen) {
      return;
    }
    const field = fieldRef.current;
    const funnel = filterBtnRef.current;
    const clip =
      rootRef.current?.closest(".hits-pane") ?? rootRef.current ?? null;
    if (field === null || funnel === null || clip === null) {
      return;
    }
    const apply = (): void => {
      const width = measureFilterPanelWidth(
        field.getBoundingClientRect(),
        funnel.getBoundingClientRect(),
        clip.getBoundingClientRect(),
      );
      setPanelWidth(width > 0 ? width : null);
    };
    apply();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    observer?.observe(field);
    observer?.observe(funnel);
    observer?.observe(clip);
    window.addEventListener("resize", apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [filterPanelOpen]);

  useEffect(() => {
    if (!filterPanelOpen || !pendingFocus.current) {
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
  }, [filterPanelOpen, extras.length, firstEmptyExtra]);

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
    if (!filterPanelOpen && !histOpen) {
      return;
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        !rootRef.current.contains(target)
      ) {
        setFilterPanelOpen(false);
        setHistOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setFilterPanelOpen(false);
      setHistOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [filterPanelOpen, histOpen]);

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
    if (event.key === "Escape" && (filterPanelOpen || histOpen)) {
      event.preventDefault();
      event.stopPropagation();
      setFilterPanelOpen(false);
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
        className={filterPanelOpen || histOpen ? "search-bar is-open" : "search-bar"}
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
            ref={fieldRef}
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
          {filterPanelOpen ? (
            <div
              className={
                panelWidth !== null
                  ? "search-filter-pop search-filter-block is-anchored"
                  : "search-filter-pop search-filter-block"
              }
              role="dialog"
              aria-label={t("filterPanelTitle")}
              style={
                panelWidth !== null
                  ? {
                      width: `${panelWidth}px`,
                      maxWidth: `${panelWidth}px`,
                      minWidth: 0,
                    }
                  : undefined
              }
            >
              <div className="search-filter-list">
                {extras.map((part, extraIndex) => {
                  const index = extraIndex + 1;
                  return (
                    <div key={part.id} className="search-filter-item">
                      {extraIndex > 0 ? (
                        <div className="search-filter-join" aria-hidden="true">
                          <span className="search-filter-line" />
                          <span className="search-filter-badge">
                            <IconFilter />
                            {t("filterLabel")}
                          </span>
                          <span className="search-filter-line" />
                        </div>
                      ) : null}
                      <div className="search-filter-row">
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
                            aria-label={t("filterAdd")}
                            placeholder={t("filterPlaceholder")}
                            title={
                              part.value.trim() !== "" ? part.value : undefined
                            }
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
                          {part.value.trim() !== "" ? (
                            <button
                              type="button"
                              className="search-filter-clear"
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
                        <div className="search-filter-mods">
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
                          aria-label={t("filterRemove")}
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
              <div className="search-filter-foot">
                <p
                  className="search-filter-hint"
                  title={`Shift+Enter ${t("filterAddHint")} · ${t("filterLimitHint")}`}
                >
                  Shift+Enter {t("filterAddHintShort")}
                </p>
                <div className="search-filter-actions">
                  <button
                    type="button"
                    className="search-filter-more"
                    disabled={!canAdd}
                    aria-label={t("filterAdd")}
                    title={t("filterAdd")}
                    onClick={(event) => {
                      event.preventDefault();
                      addField();
                    }}
                  >
                    <IconPlus />
                    {t("filterAddShort")}
                  </button>
                  <button
                    type="button"
                    className="search-filter-go"
                    disabled={searchLocked}
                    onClick={(event) => {
                      event.preventDefault();
                      sendSearch();
                    }}
                  >
                    {t("search")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          ref={filterBtnRef}
          className={
            filterPanelOpen || extraCount > 0
              ? "search-add-field is-on"
              : "search-add-field"
          }
          aria-label={t("filterPanelTitle")}
          title={t("filterPanelTitle")}
          aria-expanded={filterPanelOpen}
          onClick={(event) => {
            event.preventDefault();
            toggleAnd();
          }}
        >
          <IconFilter />
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
      {filterPanelOpen || histOpen ? (
        <div
          className="search-drop-backdrop"
          onMouseDown={(event) => {
            event.preventDefault();
            setFilterPanelOpen(false);
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
