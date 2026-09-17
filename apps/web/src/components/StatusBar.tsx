import type {
  JsonError,
  MetaResponse,
  SseDone,
  SseProgress,
} from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import { useTheme } from "../hooks/useTheme.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { IconMoon, IconSun, IconWarn } from "./icons.tsx";

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

export function LocaleToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  if (compact) {
    const next = locale === "zh-CN" ? "en-US" : "zh-CN";
    return (
      <button
        type="button"
        className="locale-cycle"
        aria-label={`${t("localeZh")} / ${t("localeEn")}`}
        title={`${t("localeZh")} / ${t("localeEn")}`}
        onClick={() => {
          setLocale(next);
        }}
      >
        {locale === "zh-CN" ? t("localeZh") : t("localeEn")}
      </button>
    );
  }
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

export function InfoCue({ message }: { message: string | null }) {
  if (message === null || message === "") {
    return null;
  }
  return (
    <div className="info-cue" role="status">
      <span className="info-cue-label">{message}</span>
    </div>
  );
}

export function WarnBanners({ done }: { done: SseDone | null }) {
  const { t } = useLocale();
  if (done === null || (!done.truncated && !done.timedOut)) {
    return null;
  }
  return (
    <div className="warn-stack">
      {done.truncated ? (
        <div className="warn-banner">
          <IconWarn />
          <span className="warn-label">{t("truncatedBanner")}</span>
        </div>
      ) : null}
      {done.timedOut ? (
        <div className="warn-banner">
          <IconWarn />
          <span className="warn-label">{t("timedOutBanner")}</span>
        </div>
      ) : null}
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
        ? t("searchProgressMeta", {
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
    text = t("resultsStatus", {
      matchCount: done.matchCount,
      fileCount: done.fileCount,
      elapsedMs: Math.round(done.elapsedMs),
    });
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
        className={
          status === "running" ? "status-text progress-meta" : "status-text"
        }
        role={isAlert ? "alert" : isStatus ? "status" : undefined}
        aria-live="polite"
      >
        {text}
      </div>
      {status === "running" && onCancel !== undefined ? (
        <button type="button" className="status-cancel" onClick={onCancel}>
          {t("cancel")}
        </button>
      ) : null}
      {meta?.engine === "none" ? (
        <div className="status-banner">{t("engineNoneBanner")}</div>
      ) : null}
    </div>
  );
}
