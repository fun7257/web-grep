import type { JsonError, MetaResponse, SseDone } from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchStatus } from "../state/searchReducer.ts";

export function StatusBar({
  status,
  done,
  error,
  hostForbidden,
  meta,
}: {
  status: SearchStatus;
  done: SseDone | null;
  error: JsonError | null;
  hostForbidden: boolean;
  meta: MetaResponse | null;
}) {
  const { locale, setLocale, t } = useLocale();

  let text = "";
  if (hostForbidden) {
    text = t("hostNotAllowed");
  } else if (status === "running") {
    text = t("loading");
  } else if (status === "cancelled") {
    text = t("cancelled");
  } else if (status === "error") {
    text =
      error?.code === "FORBIDDEN_HOST"
        ? t("hostNotAllowed")
        : (error?.message ?? t("searchFailed"));
  } else if (status === "done" && done !== null) {
    const parts = [
      t("resultsStatus", {
        matchCount: done.matchCount,
        fileCount: done.fileCount,
        elapsedMs: Math.round(done.elapsedMs),
      }),
    ];
    if (done.truncated) {
      parts.push(t("truncated"));
    }
    if (done.timedOut) {
      parts.push(t("timedOut"));
    }
    text = parts.join(" · ");
  }

  const isAlert = hostForbidden || status === "error";
  const isStatus =
    !isAlert &&
    (status === "running" || status === "cancelled" || status === "done");

  return (
    <footer className="status-bar">
      <div
        className="status-text"
        role={isAlert ? "alert" : isStatus ? "status" : undefined}
        aria-live="polite"
      >
        {text}
      </div>
      {meta?.engine === "literal" ? (
        <div className="status-banner">{t("literalEngineBanner")}</div>
      ) : null}
      {meta?.engine === "none" ? (
        <div className="status-banner">{t("engineNoneBanner")}</div>
      ) : null}
      <div className="locale-toggle">
        <button
          type="button"
          aria-pressed={locale === "zh-CN"}
          onClick={() => {
            setLocale("zh-CN");
          }}
        >
          {t("localeZh")}
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          aria-pressed={locale === "en-US"}
          onClick={() => {
            setLocale("en-US");
          }}
        >
          {t("localeEn")}
        </button>
      </div>
    </footer>
  );
}
