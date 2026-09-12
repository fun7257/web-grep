import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import type { QueryPart, SearchModifiers } from "../searchStack.ts";
import { newPart } from "../searchStack.ts";
import { IconCaret, IconSearch } from "./icons.tsx";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const extraCount = Math.max(0, parts.length - 1);
  const leadPart = parts[0];

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
    setEditorOpen(false);
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
    if (!editorOpen) {
      return;
    }
    const node = editorRef.current;
    if (node !== null) {
      node.focus();
      const at = node.value.length;
      node.setSelectionRange(at, at);
    }
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
    if (event.shiftKey) {
      addTerm(draft);
      return;
    }
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
            <div className="search-chip-row">
              {leadPart !== undefined ? (
                <span className="q-token">
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
              ) : null}
              {extraCount > 0 ? (
                <button
                  type="button"
                  className="search-more"
                  aria-label={t("queryMore", { n: extraCount })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditorOpen(true);
                  }}
                >
                  {t("queryMore", { n: extraCount })}
                </button>
              ) : null}
            </div>
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
              placeholder={parts.length === 0 ? t("queryPlaceholder") : ""}
              value={draft}
              onChange={(event) => {
                onDraftChange(event.target.value);
              }}
              onKeyDown={onQueryKeyDown}
            />
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
                <div className="search-editor-chips">
                  <QueryChips
                    parts={parts}
                    onRemove={removePart}
                    opAnd={t("opAnd")}
                  />
                </div>
              ) : null}
              <textarea
                ref={editorRef}
                className="search-editor-input"
                rows={3}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t("queryPlaceholder")}
                value={draft}
                onChange={(event) => {
                  onDraftChange(event.target.value);
                }}
                onKeyDown={onQueryKeyDown}
              />
              <p className="search-editor-hint">{t("queryAdd")}</p>
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
