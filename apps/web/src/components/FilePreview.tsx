import type { SseHit } from "@web-grep/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canFormat,
  detectLineKind,
  kindLabel,
  type FileKind,
} from "../formats/detect.ts";
import { JSON_INDENT, mappedSelection } from "../formats/jsonPieces.ts";
import { mappedMarkdownSelection } from "../formats/markdownPieces.ts";
import { PREVIEW_CHUNK } from "../api/fileClient.ts";
import { copyText } from "../copyText.ts";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";
import { useFileWindow } from "../hooks/useFileWindow.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { FormattedLine } from "./FormattedPreview.tsx";
import {
  IconBinary,
  IconCheck,
  IconCopy,
  IconExpand,
  IconShare,
  IdleMark,
} from "./icons.tsx";
import { PreviewFindBar } from "./PreviewFindBar.tsx";
import { HighlightedText } from "./ResultRow.tsx";

function previewCopyText(
  path: string,
  text: string,
  formatted: boolean,
): string {
  if (!formatted) {
    return text;
  }
  if (detectLineKind(path, text) === "json") {
    try {
      return JSON.stringify(JSON.parse(text.trim()), null, JSON_INDENT);
    } catch {
      return text;
    }
  }
  return text;
}

function selectionIn(root: HTMLElement | null): string {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || root === null) {
    return "";
  }
  const anchor = sel.anchorNode;
  if (anchor === null || !root.contains(anchor)) {
    return "";
  }
  return sel.toString().trim();
}

function isBodySelection(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.anchorNode === null) {
    return false;
  }
  if (!root.contains(sel.anchorNode)) {
    return false;
  }
  const el =
    sel.anchorNode instanceof Element
      ? sel.anchorNode
      : sel.anchorNode.parentElement;
  return el !== null && el.closest(".preview-header, .preview-find") === null;
}

function selectionLastRect(root: HTMLElement): DOMRect | null {
  if (!isBodySelection(root)) {
    return null;
  }
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  const rects =
    typeof range.getClientRects === "function" ? range.getClientRects() : null;
  if (rects !== null && rects.length > 0) {
    return rects.item(rects.length - 1);
  }
  if (typeof range.getBoundingClientRect === "function") {
    return range.getBoundingClientRect();
  }
  return new DOMRect(8, 8, 0, 0);
}

function menuPosFromPoint(x: number, y: number): { x: number; y: number } {
  const pad = 8;
  const w = 148;
  const h = 44;
  return {
    x: Math.min(Math.max(pad, x), window.innerWidth - w - pad),
    y: Math.min(Math.max(pad, y), window.innerHeight - h - pad),
  };
}

function menuPosFromRect(rect: DOMRect): { x: number; y: number } {
  const h = 44;
  const below = rect.bottom + 6;
  const y =
    below + h > window.innerHeight - 8 ? rect.top - h - 6 : below;
  return menuPosFromPoint(rect.left, y);
}

function mappedBodySelection(
  root: HTMLElement | null,
  original: string,
  kind: FileKind,
  formattedOn: boolean,
): string {
  const visible = selectionIn(root);
  if (!formattedOn || root === null) {
    return visible;
  }
  if (kind === "json") {
    const mapped = mappedSelection(root, original).trim();
    return mapped !== "" ? mapped : visible;
  }
  if (kind === "markdown") {
    const mapped = mappedMarkdownSelection(root, original).trim();
    return mapped !== "" ? mapped : visible;
  }
  return visible;
}

export function FilePreview({
  hit,
  browsePath = null,
  browseEpoch = 0,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onShare,
  onOpenContext,
  onSearchSelected,
  onCopyNotice,
}: {
  hit: SseHit | null;
  browsePath?: string | null;
  browseEpoch?: number;
  terms?: import("../highlight.ts").HlTermInput[];
  opts?: HlOpts;
  onShare?: () => void;
  onOpenContext?: () => void;
  onSearchSelected?: (text: string) => void;
  onCopyNotice?: (msg: string) => void;
}) {
  if (browsePath !== null && browsePath !== "") {
    return (
      <FilePreviewBrowse
        key={`${browsePath}:${browseEpoch}`}
        path={browsePath}
        {...(onOpenContext !== undefined ? { onOpenContext } : {})}
        {...(onCopyNotice !== undefined ? { onCopyNotice } : {})}
      />
    );
  }
  if (hit === null) {
    return <PreviewIdle />;
  }
  return (
    <FilePreviewReady
      key={`${hit.path}:${hit.line}`}
      hit={hit}
      terms={terms}
      opts={opts}
      {...(onShare !== undefined ? { onShare } : {})}
      {...(onOpenContext !== undefined ? { onOpenContext } : {})}
      {...(onSearchSelected !== undefined ? { onSearchSelected } : {})}
      {...(onCopyNotice !== undefined ? { onCopyNotice } : {})}
    />
  );
}

function PreviewSkeleton() {
  return (
    <div className="preview-skel" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="preview-skel-line">
          <span className="skel-n" />
          <span className="skel-t" style={{ width: `${46 + (index % 4) * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

function PreviewGapBody({
  kind,
}: {
  kind: "binary" | "denied" | "empty";
}) {
  const { t } = useLocale();
  if (kind === "binary") {
    return (
      <div className="preview-empty">
        <IconBinary />
        <p className="empty-title">{t("previewBinary")}</p>
        <p className="empty-helper">{t("previewBinaryHelper")}</p>
      </div>
    );
  }
  if (kind === "denied") {
    return (
      <div className="preview-empty">
        <IdleMark kind="nomatch" />
        <p className="empty-title">{t("previewDenied")}</p>
        <p className="empty-helper">{t("previewDeniedHelper")}</p>
        <p className="empty-code">{t("previewDeniedCode")}</p>
      </div>
    );
  }
  return (
    <div className="preview-empty">
      <IdleMark kind="preview" />
      <p className="empty-title">{t("previewFileEmpty")}</p>
    </div>
  );
}

function FilePreviewBrowse({
  path,
  onOpenContext,
  onCopyNotice,
}: {
  path: string;
  onOpenContext?: () => void;
  onCopyNotice?: (msg: string) => void;
}) {
  const { t } = useLocale();
  const {
    lines,
    error,
    errorCode,
    binary,
    eof,
    loading,
    pathRef,
    reset,
    loadSlice,
  } = useFileWindow(t);
  pathRef.current = path;

  useEffect(() => {
    const ac = new AbortController();
    reset();
    void loadSlice(
      { path, from: 1, count: PREVIEW_CHUNK },
      { mode: "replace", signal: ac.signal },
    );
    return () => {
      ac.abort();
    };
  }, [loadSlice, path, reset]);

  const denied = errorCode === "DENIED";
  const copyPath = (): void => {
    void copyText(path);
    onCopyNotice?.(`${t("copiedPath")}: ${path}`);
  };

  return (
    <div className="preview preview-browse">
      <header className="preview-header">
        <span className="preview-path" title={path} onClick={copyPath}>
          {path}
        </span>
        <div className="preview-tools">
          {onOpenContext !== undefined ? (
            <button
              type="button"
              className="preview-icon-btn"
              title={t("previewContext")}
              aria-label={t("previewContext")}
              onClick={onOpenContext}
            >
              <IconExpand />
            </button>
          ) : null}
        </div>
      </header>
      {denied ? (
        <PreviewGapBody kind="denied" />
      ) : binary ? (
        <PreviewGapBody kind="binary" />
      ) : loading ||
        (lines.length === 0 && error === null && !eof) ? (
        <PreviewSkeleton />
      ) : error !== null && lines.length === 0 ? (
        <div className="preview-empty">
          <IdleMark kind="nomatch" />
          <p className="empty-title danger">{error}</p>
        </div>
      ) : lines.length === 0 ? (
        <PreviewGapBody kind="empty" />
      ) : (
        <div className="preview-hit preview-browse-body">
          {lines.map((line) => (
            <div key={line.n} className="preview-line">
              <span className="preview-n">{line.n}</span>
              <span className="preview-text">{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewIdle() {
  const { t } = useLocale();
  return (
    <div className="preview preview-idle">
      <IdleMark kind="preview" />
      <p className="empty-title">{t("previewEmpty")}</p>
      <p className="empty-helper">{t("previewEmptyHelper")}</p>
    </div>
  );
}

function FilePreviewReady({
  hit,
  terms,
  opts,
  onShare,
  onOpenContext,
  onSearchSelected,
  onCopyNotice,
}: {
  hit: SseHit;
  terms: import("../highlight.ts").HlTermInput[];
  opts: HlOpts;
  onShare?: () => void;
  onOpenContext?: () => void;
  onSearchSelected?: (text: string) => void;
  onCopyNotice?: (msg: string) => void;
}) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const kind = detectLineKind(hit.path, hit.text);
  const formattedAvailable = canFormat(kind);
  const [mode, setMode] = useState<"formatted" | "source">(
    formattedAvailable ? "formatted" : "source",
  );
  const [copiedKind, setCopiedKind] = useState<"preview" | null>(null);
  const copiedTimer = useRef<number>(0);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dismissPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const closeSelMenu = useCallback((): void => {
    setSelMenu(null);
  }, []);

  const dismissSelMenu = useCallback((event: MouseEvent): void => {
    dismissPoint.current = { x: event.clientX, y: event.clientY };
    setSelMenu(null);
  }, []);

  useEffect(() => {
    const onUp = (): void => {
      window.setTimeout(() => {
        dismissPoint.current = null;
      }, 0);
    };
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const openSelMenuAtRect = useCallback((): void => {
    const root = rootRef.current;
    if (root === null || onSearchSelected === undefined) {
      setSelMenu(null);
      return;
    }
    const rect = selectionLastRect(root);
    if (rect === null) {
      setSelMenu(null);
      return;
    }
    setSelMenu(menuPosFromRect(rect));
  }, [onSearchSelected]);

  const searchFromSelection = useCallback((): void => {
    const text = mappedBodySelection(
      rootRef.current,
      hit.text,
      kind,
      mode === "formatted" && formattedAvailable,
    );
    setSelMenu(null);
    if (text !== "") {
      onSearchSelected?.(text);
    }
  }, [formattedAvailable, hit.text, kind, mode, onSearchSelected]);

  const flashCopied = (kind: "preview"): void => {
    setCopiedKind(kind);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedKind(null);
    }, 1200);
  };

  const copyPathWithLine = (): void => {
    const text = `${hit.path}:${hit.line}`;
    void copyText(text);
    onCopyNotice?.(`${t("copiedLine")}: ${text}`);
  };

  const copyPreview = (): void => {
    const body = previewCopyText(
      hit.path,
      hit.text,
      mode === "formatted" && formattedAvailable,
    );
    void copyText(body);
    flashCopied("preview");
    onCopyNotice?.(t("copiedPreview"));
  };

  const formatted =
    mode === "formatted" && formattedAvailable ? (
      <FormattedLine
        path={hit.path}
        text={hit.text}
        terms={terms}
        opts={opts}
      />
    ) : null;

  return (
    <div
      className="preview"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        if (
          event.target instanceof Element &&
          event.target.closest(".sel-menu") !== null
        ) {
          return;
        }
        if (selMenu !== null) {
          dismissPoint.current = { x: event.clientX, y: event.clientY };
          setSelMenu(null);
        }
      }}
      onMouseUp={(event) => {
        if (event.button !== 0) {
          return;
        }
        if (
          event.target instanceof Element &&
          event.target.closest(".sel-menu") !== null
        ) {
          return;
        }
        if (
          event.target instanceof Element &&
          event.target.closest(".preview-header, .preview-find") !== null
        ) {
          setSelMenu(null);
          dismissPoint.current = null;
          return;
        }
        const down = dismissPoint.current;
        dismissPoint.current = null;
        if (down !== null) {
          const dx = event.clientX - down.x;
          const dy = event.clientY - down.y;
          if (dx * dx + dy * dy < 16) {
            return;
          }
        }
        window.setTimeout(() => {
          openSelMenuAtRect();
        }, 0);
      }}
      onContextMenu={(event) => {
        if (onSearchSelected === undefined) {
          return;
        }
        const root = rootRef.current;
        if (root === null || !isBodySelection(root)) {
          return;
        }
        event.preventDefault();
        setSelMenu(menuPosFromPoint(event.clientX, event.clientY));
      }}
    >
      <header className="preview-header">
        <span
          className="preview-path"
          title={`${hit.path}:${hit.line} (点击复制)`}
          onClick={copyPathWithLine}
        >
          {hit.path}
          <span className="preview-path-line">:{hit.line}</span>
        </span>
        <div className="preview-tools">
          <span className="kind-badge">{kindLabel(kind, hit.path)}</span>
          {formattedAvailable ? (
            <div className="view-toggle">
              <button
                type="button"
                aria-pressed={mode === "formatted"}
                onClick={() => {
                  setMode("formatted");
                }}
              >
                {t("previewFormatted")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "source"}
                onClick={() => {
                  setMode("source");
                }}
              >
                {t("previewSource")}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={
              copiedKind === "preview"
                ? "preview-icon-btn is-copied"
                : "preview-icon-btn"
            }
            title={t("copyPreview")}
            aria-label={t("copyPreview")}
            onClick={copyPreview}
          >
            {copiedKind === "preview" ? <IconCheck /> : <IconCopy />}
          </button>
          {onOpenContext !== undefined ? (
            <button
              type="button"
              className="preview-icon-btn"
              title={t("previewContext")}
              aria-label={t("previewContext")}
              onClick={onOpenContext}
            >
              <IconExpand />
            </button>
          ) : null}
          {onShare !== undefined ? (
            <button
              type="button"
              className="preview-icon-btn"
              title={t("shareTitle")}
              aria-label={t("shareTitle")}
              onClick={onShare}
            >
              <IconShare />
            </button>
          ) : null}
          <PreviewFindBar
            rootRef={rootRef}
            contentKey={`${hit.path}:${hit.line}:${mode}`}
          />
        </div>
      </header>
      {formatted ?? (
        <div className="preview-hit">
          <div className="preview-line current" aria-current="location">
            <span className="preview-n">{hit.line}</span>
            <span className="preview-text">
              <HighlightedText
                text={hit.text}
                matches={hit.matches}
                terms={terms}
                opts={opts}
              />
            </span>
          </div>
        </div>
      )}
      {selMenu !== null && onSearchSelected !== undefined ? (
        <SelectionMenu
          x={selMenu.x}
          y={selMenu.y}
          label={t("searchSelected")}
          onPick={searchFromSelection}
          onClose={closeSelMenu}
          onPointerDismiss={dismissSelMenu}
        />
      ) : null}
    </div>
  );
}

function SelectionMenu({
  x,
  y,
  label,
  onPick,
  onClose,
  onPointerDismiss,
}: {
  x: number;
  y: number;
  label: string;
  onPick: () => void;
  onClose: () => void;
  onPointerDismiss: (event: MouseEvent) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onDown = (event: MouseEvent): void => {
      const node = menuRef.current;
      if (
        node !== null &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        onPointerDismiss(event);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose, onPointerDismiss]);

  return (
    <div
      ref={menuRef}
      className="sel-menu"
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <button type="button" role="menuitem" onClick={onPick}>
        {label}
      </button>
    </div>
  );
}
