import type { JsonError, SseDone } from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchStatus } from "../state/searchReducer.ts";
import { IdleMark } from "./icons.tsx";

export function EmptyState({
  status,
  hitCount,
  done,
  error,
  hostForbidden,
}: {
  status: SearchStatus;
  hitCount: number;
  done: SseDone | null;
  error: JsonError | null;
  hostForbidden: boolean;
}) {
  const { t } = useLocale();

  if (hitCount > 0) {
    return null;
  }
  if (hostForbidden) {
    return <div className="empty-state">{t("hostNotAllowed")}</div>;
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
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="empty-state empty-idle">
        <IdleMark kind="nomatch" />
        <p className="empty-title">
          {error?.code === "FORBIDDEN_HOST"
            ? t("hostNotAllowed")
            : (error?.message ?? t("searchFailed"))}
        </p>
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
