import type { SseHit } from "@web-grep/shared";
import { useEffect, useRef, useState } from "react";
import { fetchFileWindow } from "../api/fileClient.ts";
import { SearchHttpError } from "../api/searchClient.ts";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { HighlightedText } from "./ResultRow.tsx";

export const CONTEXT_BEFORE = 30;
export const CONTEXT_COUNT = 61;

type WindowLine = { n: number; text: string };

export function ContextModal({
  open,
  hit,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onClose,
}: {
  open: boolean;
  hit: SseHit | null;
  terms?: string[];
  opts?: HlOpts;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const currentRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<WindowLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);

  useEffect(() => {
    if (!open || hit === null) {
      setLines(null);
      setError(null);
      setBinary(false);
      return;
    }
    const ac = new AbortController();
    const from = Math.max(1, hit.line - CONTEXT_BEFORE);
    void (async () => {
      try {
        const win = await fetchFileWindow(
          { path: hit.path, from, count: CONTEXT_COUNT },
          ac.signal,
        );
        if (win.binary) {
          setBinary(true);
          setLines(null);
          return;
        }
        setBinary(false);
        setLines(win.lines);
      } catch (err) {
        if (ac.signal.aborted) {
          return;
        }
        setError(
          err instanceof SearchHttpError ? err.body.message : t("searchFailed"),
        );
      }
    })();
    return () => {
      ac.abort();
    };
  }, [hit, open, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (lines === null) {
      return;
    }
    currentRef.current?.scrollIntoView?.({ block: "center" });
  }, [lines]);

  if (!open || hit === null) {
    return null;
  }

  return (
    <div
      className="token-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("previewContext")}
      onClick={onClose}
    >
      <div
        className="context-modal"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="hotkey-header">
          <h2>
            {hit.path}
            <span className="preview-path-line">:{hit.line}</span>
          </h2>
          <button
            type="button"
            className="hotkey-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
        {error !== null ? (
          <p className="context-status">{error}</p>
        ) : binary ? (
          <p className="context-status">{t("previewBinary")}</p>
        ) : lines === null ? (
          <p className="context-status">{t("loading")}</p>
        ) : (
          <div className="context-lines">
            {lines.map((line) => {
              const current = line.n === hit.line;
              return (
                <div
                  key={line.n}
                  className={current ? "preview-line current" : "preview-line"}
                  ref={current ? currentRef : undefined}
                  {...(current ? { "aria-current": "location" as const } : {})}
                >
                  <span className="preview-n">{line.n}</span>
                  <span className="preview-text">
                    <HighlightedText
                      text={line.text}
                      terms={terms}
                      opts={opts}
                      matches={current ? hit.matches : []}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
