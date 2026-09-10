import type { JsonError, SseDone } from "@web-grep/shared";
import { useLocale } from "../hooks/useLocale.ts";
import type { SearchStatus } from "../state/searchReducer.ts";

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
    return <div className="empty-state">{t("loading")}</div>;
  }
  if (status === "cancelled") {
    return <div className="empty-state">{t("cancelled")}</div>;
  }
  if (status === "error") {
    return (
      <div className="empty-state">
        {error?.code === "FORBIDDEN_HOST"
          ? t("hostNotAllowed")
          : (error?.message ?? t("searchFailed"))}
      </div>
    );
  }
  if (status === "done" && (done?.matchCount === 0 || hitCount === 0)) {
    return <div className="empty-state">{t("noResults")}</div>;
  }
  return <div className="empty-state">{t("emptyHint")}</div>;
}
