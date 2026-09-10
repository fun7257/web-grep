import { type FormEvent, useState } from "react";
import { useLocale } from "../hooks/useLocale.ts";

export function TokenPrompt({
  onSubmit,
}: {
  onSubmit: (token: string) => void;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState("");

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const token = value.trim();
    if (token === "") {
      return;
    }
    onSubmit(token);
  };

  return (
    <div className="token-overlay">
      <form
        className="token-prompt"
        role="dialog"
        aria-labelledby="token-prompt-title"
        aria-modal="true"
        onSubmit={handleSubmit}
      >
        <h2 id="token-prompt-title">{t("tokenPrompt")}</h2>
        <label htmlFor="web-grep-token">{t("tokenPrompt")}</label>
        <input
          id="web-grep-token"
          type="password"
          name="token"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <button type="submit">{t("tokenSubmit")}</button>
      </form>
    </div>
  );
}
