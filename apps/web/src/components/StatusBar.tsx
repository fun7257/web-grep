import type {
  JsonError,
  MetaResponse,
  SseDone,
  SseProgress,
} from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import { useTheme } from "../hooks/useTheme.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { IconMoon, IconSun } from "./icons.tsx";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={t("themeToggle")}
      title={theme === "dark" ? t("themeLight") : t("themeDark")}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
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
  );
}

export function StatusBar({
  status,
  done,
  progress,
  error,
  hostForbidden,
  meta,
  onCancel,
}: {
  status: SearchStatus;
  done: SseDone | null;
  progress: SseProgress | null;
  error: JsonError | null;
  hostForbidden: boolean;
  meta: MetaResponse | null;
  onCancel?: () => void;
}) {
  const { t } = useLocale();

  let text = "";
  if (hostForbidden) {
    text = t("hostNotAllowed");
  } else if (status === "running") {
    text =
      progress !== null
        ? t("searchProgress", {
            files: progress.files,
            matches: progress.matches,
          })
        : t("loading");
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

  if (text === "" && meta?.engine !== "none") {
    return null;
  }

  return (
    <div className="status-bar" data-status={status}>
      <div
        className="status-text"
        role={isAlert ? "alert" : isStatus ? "status" : undefined}
        aria-live="polite"
      >
        {text}
      </div>
      {status === "running" && onCancel !== undefined ? (
        <button
          type="button"
          className="status-cancel"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
      ) : null}
      {meta?.engine === "none" ? (
        <div className="status-banner">{t("engineNoneBanner")}</div>
      ) : null}
    </div>
  );
}
