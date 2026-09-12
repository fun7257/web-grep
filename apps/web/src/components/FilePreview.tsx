import type { SseHit } from "@web-grep/shared";
import { useEffect, useRef, useState } from "react";
import { canFormat, detectLineKind, kindLabel } from "../formats/detect.ts";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { FormattedLine } from "./FormattedPreview.tsx";
import { IconCheck, IconCopy, IconShare } from "./icons.tsx";
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
      return JSON.stringify(JSON.parse(text.trim()), null, 2);
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

export function FilePreview({
  hit,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onShare,
  onSearchSelected,
  onCopyNotice,
}: {
  hit: SseHit | null;
  terms?: string[];
  opts?: HlOpts;
  onShare?: () => void;
  onSearchSelected?: (text: string) => void;
  onCopyNotice?: (msg: string) => void;
}) {
  if (hit === null) {
    return <div className="preview preview-idle" />;
  }
  return (
    <FilePreviewReady
      key={`${hit.path}:${hit.line}`}
      hit={hit}
      terms={terms}
      opts={opts}
      {...(onShare !== undefined ? { onShare } : {})}
      {...(onSearchSelected !== undefined ? { onSearchSelected } : {})}
      {...(onCopyNotice !== undefined ? { onCopyNotice } : {})}
    />
  );
}

function FilePreviewReady({
  hit,
  terms,
  opts,
  onShare,
  onSearchSelected,
  onCopyNotice,
}: {
  hit: SseHit;
  terms: string[];
  opts: HlOpts;
  onShare?: () => void;
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

  useEffect(() => {
    return () => {
      window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const flashCopied = (kind: "preview"): void => {
    setCopiedKind(kind);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedKind(null);
    }, 1200);
  };

  const copyPathWithLine = (): void => {
    const text = `${hit.path}:${hit.line}`;
    void navigator.clipboard?.writeText(text);
    onCopyNotice?.(`${t("copiedLine")}: ${text}`);
  };

  const copyPreview = (): void => {
    const body = previewCopyText(
      hit.path,
      hit.text,
      mode === "formatted" && formattedAvailable,
    );
    void navigator.clipboard?.writeText(body);
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
    <div className="preview" ref={rootRef}>
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
          {onSearchSelected !== undefined ? (
            <button
              type="button"
              className="preview-btn"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                const text = selectionIn(rootRef.current);
                if (text !== "") {
                  onSearchSelected(text);
                }
              }}
            >
              {t("searchSelected")}
            </button>
          ) : null}
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
    </div>
  );
}
