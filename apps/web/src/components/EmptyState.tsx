import { type JsonError, type SseDone } from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { IdleMark } from "./icons.tsx";

function isEngineError(code: string | undefined): boolean {
  return code === "ENGINE";
}

export function EmptyState({
  status,
  hitCount,
  done,
  error,
  hostForbidden,
  engine,
  treeCollapsed = false,
}: {
  status: SearchStatus;
  hitCount: number;
  done: SseDone | null;
  error: JsonError | null;
  hostForbidden: boolean;
  engine?: string | null;
  treeCollapsed?: boolean;
}) {
  const { t } = useLocale();
  const engineDown = engine === "none" || isEngineError(error?.code);

  if (hitCount > 0) {
    return null;
  }
  if (hostForbidden || error?.code === "FORBIDDEN_HOST") {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title danger">{t("hostNotAllowed")}</p>
        <p className="empty-helper">{t("hostForbiddenHelper")}</p>
        <p className="empty-code">{t("errorCodeHost")}</p>
      </div>
    );
  }
  if (engineDown && (status === "error" || status === "idle" || engine === "none")) {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title danger">{t("engineUnavailable")}</p>
        <p className="empty-helper">{t("engineUnavailableHelper")}</p>
        <p className="empty-code">{t("errorCodeEngine")}</p>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="empty-state empty-idle is-running">
        <IdleMark kind="hits" />
        <p className="empty-title">{t("loading")}</p>
      </div>
    );
  }
  if (status === "cancelled") {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title">{t("cancelled")}</p>
        <p className="empty-helper">{t("cancelledHelper")}</p>
        <p className="empty-code">{t("errorCodeCancelled")}</p>
      </div>
    );
  }
  if (status === "error" && error?.code === "BUSY") {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title">{t("searchBusy")}</p>
        <p className="empty-helper">{t("searchBusyHelper")}</p>
        <p className="empty-code">{t("errorCodeBusy")}</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title danger">
          {error?.message ?? t("searchFailed")}
        </p>
      </div>
    );
  }
  if (treeCollapsed) {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="hits" />
        <p className="empty-title">{t("treeCollapsed")}</p>
        <p className="empty-helper">{t("treeCollapsedHelper")}</p>
      </div>
    );
  }
  if (status === "done" && (done?.matchCount === 0 || hitCount === 0)) {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title">{t("noResults")}</p>
        <p className="empty-helper">{t("noResultsHelper")}</p>
      </div>
    );
  }
  return (
    <div className="empty-state empty-idle">
      <IdleMark kind="hits" />
      <p className="empty-title">{t("emptyHint")}</p>
      <p className="empty-helper">{t("emptyHintHelper")}</p>
    </div>
  );
}
