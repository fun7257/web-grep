import { type JsonError, type SseDone } from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { IconX } from "./icons.tsx";
import { StateButton, StateView } from "./StateView.tsx";
import {
  IconStateBan,
  IconStateClock,
  IconStatePanel,
  IconStateSearch,
  IconStateServer,
  IconStateWarn,
} from "./stateIcons.tsx";

function isEngineError(code: string | undefined): boolean {
  return code === "ENGINE";
}

/** Raw rg/engine stderr must never be the empty-state title. */
export function isRawEngineStderr(message: string | undefined): boolean {
  return message !== undefined && /exit status\s+\d+/i.test(message);
}

function EngineStderr({ message }: { message: string }) {
  const { t } = useLocale();
  return (
    <details className="empty-detail">
      <summary>
        <IconStateWarn />
        {t("engineDetail")}
      </summary>
      <p className="empty-detail-body">{message}</p>
    </details>
  );
}

function IdleTips() {
  const { t } = useLocale();
  return (
    <div className="empty-tips">
      <span className="kbd">/</span>
      <span>{t("tipFocus")}</span>
      <span className="kbd">Shift ↵</span>
      <span>{t("tipAddFilter")}</span>
      <span className="kbd">Alt C / W / R</span>
      <span>{t("tipMods")}</span>
      <span className="kbd">?</span>
      <span>{t("tipHotkeys")}</span>
    </div>
  );
}

export function EmptyState({
  status,
  hitCount,
  done,
  error,
  hostForbidden,
  engine,
  treeCollapsed = false,
  timeActive = false,
  excludeActive = false,
  onClearTime,
  onClearExclude,
  onRetry,
}: {
  status: SearchStatus;
  hitCount: number;
  done: SseDone | null;
  error: JsonError | null;
  hostForbidden: boolean;
  engine?: string | null;
  treeCollapsed?: boolean;
  timeActive?: boolean;
  excludeActive?: boolean;
  onClearTime?: () => void;
  onClearExclude?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  const rawMessage = error?.message?.trim() ?? "";
  const engineDown =
    engine === "none" ||
    isEngineError(error?.code) ||
    isRawEngineStderr(rawMessage);

  // A cancelled search replaces the list with the state page, even when some
  // hits already arrived — the bar keeps the count, and Search again reruns.
  if (hitCount > 0 && status !== "cancelled") {
    return null;
  }
  if (treeCollapsed && status !== "cancelled") {
    return (
      <StateView
        icon={<IconStatePanel />}
        title={t("treeCollapsed")}
        helper={t("treeCollapsedHelper")}
      />
    );
  }
  if (hostForbidden || error?.code === "FORBIDDEN_HOST") {
    return (
      <StateView
        tone="danger"
        alert
        icon={<IconStateWarn />}
        title={t("hostNotAllowed")}
        helper={t("hostForbiddenHelper")}
        code={t("errorCodeHost")}
      />
    );
  }
  if (
    engineDown &&
    (status === "error" || status === "idle" || engine === "none")
  ) {
    const showStderr =
      rawMessage !== "" &&
      rawMessage !== t("engineUnavailable") &&
      rawMessage !== t("engineUnavailableHelper");
    return (
      <StateView
        tone="danger"
        alert
        icon={<IconStateServer />}
        title={t("engineUnavailable")}
        helper={t("engineUnavailableHelper")}
        code={t("errorCodeEngine")}
        detail={showStderr ? <EngineStderr message={rawMessage} /> : null}
      />
    );
  }
  if (status === "running") {
    return (
      <StateView
        className="is-running"
        icon={<IconStateSearch />}
        title={t("loading")}
      />
    );
  }
  if (status === "cancelled") {
    return (
      <StateView
        tone="warn"
        icon={<IconStateBan />}
        title={t("cancelled")}
        helper={t("cancelledHelper")}
        code={t("errorCodeCancelled")}
        actions={
          onRetry !== undefined ? (
            <StateButton primary onClick={onRetry}>
              {t("searchAgain")}
            </StateButton>
          ) : null
        }
      />
    );
  }
  if (status === "error" && error?.code === "BUSY") {
    return (
      <StateView
        tone="warn"
        alert
        icon={<IconStateClock />}
        title={t("searchBusy")}
        helper={t("searchBusyHelper")}
        code={t("errorCodeBusy")}
        actions={
          onRetry !== undefined ? (
            <StateButton primary onClick={onRetry}>
              {t("retry")}
            </StateButton>
          ) : null
        }
      />
    );
  }
  if (status === "error") {
    return (
      <StateView
        tone="danger"
        alert
        icon={<IconStateWarn />}
        title={rawMessage !== "" ? rawMessage : t("searchFailed")}
      />
    );
  }
  if (status === "done" && (done?.matchCount === 0 || hitCount === 0)) {
    const showTime = timeActive && onClearTime !== undefined;
    const showExclude = excludeActive && onClearExclude !== undefined;
    return (
      <StateView
        icon={<IconStateSearch />}
        title={t("noResults")}
        helper={t("noResultsHelper")}
        actions={
          showTime || showExclude ? (
            <>
              {showTime ? (
                <StateButton onClick={onClearTime}>
                  <IconStateClock />
                  {t("clearTimeRange")}
                </StateButton>
              ) : null}
              {showExclude ? (
                <StateButton onClick={onClearExclude}>
                  <IconX />
                  {t("clearExclude")}
                </StateButton>
              ) : null}
            </>
          ) : null
        }
      />
    );
  }
  return (
    <StateView
      icon={<IconStateSearch />}
      title={t("emptyHint")}
      helper={t("emptyHintHelper")}
      tips={<IdleTips />}
    />
  );
}
