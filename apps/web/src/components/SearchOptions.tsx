import { useLocale } from "../hooks/useLocale.ts";

export type SearchOptionValues = {
  path: string;
  include: string;
  exclude: string;
  regex: boolean;
  caseSensitive: boolean;
  wordMatch: boolean;
  hidden: boolean;
};

export function SearchOptions({
  values,
  onChange,
}: {
  values: SearchOptionValues;
  onChange: (patch: Partial<SearchOptionValues>) => void;
}) {
  const { t } = useLocale();

  return (
    <div className="search-options">
      <label>
        {t("path")}
        <input
          type="text"
          name="path"
          autoComplete="off"
          spellCheck={false}
          value={values.path}
          onChange={(event) => {
            onChange({ path: event.target.value });
          }}
        />
      </label>
      <label>
        {t("include")}
        <input
          type="text"
          name="include"
          autoComplete="off"
          spellCheck={false}
          value={values.include}
          onChange={(event) => {
            onChange({ include: event.target.value });
          }}
        />
      </label>
      <label>
        {t("exclude")}
        <input
          type="text"
          name="exclude"
          autoComplete="off"
          spellCheck={false}
          value={values.exclude}
          onChange={(event) => {
            onChange({ exclude: event.target.value });
          }}
        />
      </label>
      <div className="option-toggles">
        <button
          type="button"
          aria-pressed={values.regex}
          onClick={() => {
            onChange({ regex: true });
          }}
        >
          {t("regex")}
        </button>
        <button
          type="button"
          aria-pressed={!values.regex}
          onClick={() => {
            onChange({ regex: false });
          }}
        >
          {t("literal")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={values.caseSensitive}
            onChange={(event) => {
              onChange({ caseSensitive: event.target.checked });
            }}
          />
          {t("caseSensitive")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={values.wordMatch}
            onChange={(event) => {
              onChange({ wordMatch: event.target.checked });
            }}
          />
          {t("wordMatch")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={values.hidden}
            onChange={(event) => {
              onChange({ hidden: event.target.checked });
            }}
          />
          {t("hidden")}
        </label>
      </div>
    </div>
  );
}
