import type { SseHit } from "@web-grep/shared";
import { useEffect, useRef } from "react";
import type { SearchHttpError } from "../api/searchClient.ts";
import { useFilePreview } from "../hooks/useFilePreview.ts";
import { useLocale } from "../hooks/useLocale.ts";

export function copyRelativePath(path: string): void {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined) {
    return;
  }
  void clipboard.writeText(path);
}

export function FilePreview({
  hit,
  onAuthFailure,
}: {
  hit: SseHit | null;
  onAuthFailure?: (err: SearchHttpError) => void;
}) {
  const { t } = useLocale();
  const preview = useFilePreview(
    hit,
    onAuthFailure === undefined ? undefined : { onAuthFailure },
  );
  const matchLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    matchLineRef.current?.scrollIntoView({ block: "nearest" });
  }, [preview.window, hit?.line]);

  if (hit === null) {
    return null;
  }

  const copy = (): void => {
    copyRelativePath(hit.path);
  };

  return (
    <div className="preview" aria-busy={preview.loading}>
      <header className="preview-header">
        <span className="preview-path">{hit.path}</span>
        <button type="button" onClick={copy}>
          {t("copyPath")}
        </button>
      </header>
      {preview.error !== null ? (
        <div className="preview-error">{preview.error.message}</div>
      ) : null}
      {preview.window?.binary === true ? (
        <div className="preview-binary">{t("previewBinary")}</div>
      ) : null}
      {preview.window !== null && !preview.window.binary ? (
        <div className="preview-lines">
          {preview.window.lines.map((line) => {
            const current = line.n === hit.line;
            return (
              <div
                key={line.n}
                ref={current ? matchLineRef : undefined}
                className={current ? "preview-line current" : "preview-line"}
                aria-current={current ? "location" : undefined}
              >
                <span className="preview-n">{line.n}</span>
                <span className="preview-text">{line.text}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
