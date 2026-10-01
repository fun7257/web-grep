import type { JsonError, SseDone, SseProgress } from "@web-grep/shared";
import type { ReactNode, Ref } from "react";
import { useLocale } from "../hooks/useLocale.ts";
import { useTheme } from "../hooks/useTheme.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { isRawEngineStderr } from "./EmptyState.tsx";
import { IconMoon, IconSearch, IconSun, IconWarn } from "./icons.tsx";
import { IconStateClock } from "./stateIcons.tsx";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={t("themeToggle")}
      aria-pressed={theme === "dark"}
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
      <IconSearch />
      <span className="info-cue-label">{message}</span>
    </div>
  );
}

function bannerParts(text: string): { title: string; rest: string } {
  const mark = "—";
  const idx = text.indexOf(mark);
  if (idx === -1) {
    return { title: text, rest: "" };
  }
  return {
    title: text.slice(0, idx).trim(),
    rest: text.slice(idx + mark.length).trim(),
  };
}

function BannerBody({ text }: { text: string }) {
  const parts = bannerParts(text);
  return (
    <span className="warn-label">
      <b>{parts.title}</b>
      {parts.rest !== "" ? ` ${parts.rest}` : null}
    </span>
  );
}

export function WarnBanners({
  done,
  onNarrow,
  onRetry,
}: {
  done: SseDone | null;
  onNarrow?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  if (done === null || (!done.truncated && !done.timedOut)) {
    return null;
  }
  return (
    <div className="warn-stack">
      {done.truncated ? (
        <div className="warn-banner">
          <IconWarn />
          <BannerBody text={t("truncatedBanner")} />
          {onNarrow !== undefined ? (
            <button type="button" className="banner-action" onClick={onNarrow}>
              {t("narrowScope")}
            </button>
          ) : null}
        </div>
      ) : null}
      {done.timedOut ? (
        <div className="warn-banner">
          <IconStateClock />
          <BannerBody text={t("timedOutBanner")} />
          {onRetry !== undefined ? (
            <button type="button" className="banner-action" onClick={onRetry}>
              {t("retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fmtCount(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

function RichLine({
  template,
  vars,
  strong,
}: {
  template: string;
  vars: Record<string, string | number>;
  strong: ReadonlySet<string>;
}) {
  const nodes: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(template)) !== null) {
    if (match.index > last) {
      nodes.push(template.slice(last, match.index));
    }
    const name = match[1] ?? "";
    const value = vars[name];
    const text = value === undefined ? match[0] : String(value);
    if (strong.has(name)) {
      nodes.push(
        <b key={key} className="num">
          {text}
        </b>,
      );
    } else {
      nodes.push(<span key={key}>{text}</span>);
    }
    key += 1;
    last = match.index + match[0].length;
  }
  if (last < template.length) {
    nodes.push(template.slice(last));
  }
  return <span className="pane-head-summary">{nodes}</span>;
}

function alertCopy(
  t: ReturnType<typeof useLocale>["t"],
  error: JsonError | null,
  hostForbidden: boolean,
): string {
  if (hostForbidden || error?.code === "FORBIDDEN_HOST") {
    return t("hostNotAllowed");
  }
  if (error?.code === "ENGINE" || isRawEngineStderr(error?.message)) {
    return t("engineUnavailable");
  }
  if (error?.code === "BUSY") {
    return t("searchBusy");
  }
  return error?.message ?? t("searchFailed");
}

/**
 * Result-column heading. Cancel lives on the search button, not here.
 * The live region stays on this bar so a hit-bearing error is still announced
 * when the state page is hidden; zero-hit errors announce from the state title.
 */
export function ResultHead({
  status,
  done,
  progress,
  error,
  hostForbidden,
  hitCount,
  actionsRef,
}: {
  status: SearchStatus;
  done: SseDone | null;
  progress: SseProgress | null;
  error: JsonError | null;
  hostForbidden: boolean;
  hitCount: number;
  actionsRef?: Ref<HTMLDivElement>;
}) {
  const { locale, t } = useLocale();
  const isAlert = hostForbidden || status === "error";
  const alertOnBar = isAlert && hitCount > 0;
  const statusOnBar =
    !isAlert &&
    (status === "running" || status === "cancelled" || status === "done");
  const role = alertOnBar ? "alert" : statusOnBar ? "status" : undefined;

  let summary: ReactNode = null;
  if (status === "running" && progress !== null) {
    summary = (
      <RichLine
        template={t("searchProgressMeta")}
        vars={{
          files: fmtCount(progress.files, locale),
          matches: fmtCount(progress.matches, locale),
        }}
        strong={new Set(["files", "matches"])}
      />
    );
  } else if (status === "cancelled") {
    summary = (
      <RichLine
        template={t("cancelledHits")}
        vars={{ matches: fmtCount(hitCount, locale) }}
        strong={new Set(["matches"])}
      />
    );
  } else if (status === "done" && done !== null) {
    summary = (
      <RichLine
        template={t("resultsStatus")}
        vars={{
          matchCount: fmtCount(done.matchCount, locale),
          fileCount: fmtCount(done.fileCount, locale),
          elapsedMs: Math.round(done.elapsedMs),
        }}
        strong={new Set(["matchCount", "fileCount"])}
      />
    );
  } else if (alertOnBar) {
    summary = (
      <span className="pane-head-summary">
        {alertCopy(t, error, hostForbidden)}
      </span>
    );
  }

  return (
    <div
      className="pane-head"
      data-status={status}
      role={role}
      aria-live={role !== undefined ? "polite" : undefined}
    >
      {status === "running" ? (
        <span className="result-spin" aria-hidden="true" />
      ) : null}
      <span className="pane-head-title">
        {status === "running" ? t("loading") : t("paneHits")}
      </span>
      {summary}
      <div ref={actionsRef} className="pane-head-actions" />
    </div>
  );
}
