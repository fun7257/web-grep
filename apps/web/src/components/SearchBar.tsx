import type { FormEvent, RefObject } from "react";
import { useLocale } from "../hooks/useLocale.ts";

export function SearchBar({
  query,
  onQueryChange,
  running,
  onSubmit,
  onCancel,
  queryRef,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  running: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  queryRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useLocale();

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit} noValidate>
      <input
        ref={queryRef}
        type="text"
        name="query"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder={t("queryPlaceholder")}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
      />
      <button type="submit">{t("search")}</button>
      <button type="button" disabled={!running} onClick={onCancel}>
        {t("cancel")}
      </button>
    </form>
  );
}
