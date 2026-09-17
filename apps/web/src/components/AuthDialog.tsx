import { type FormEvent, useState } from "react";
import { SearchHttpError } from "../api/searchClient.ts";
import { useLocale } from "../hooks/useLocale.ts";
import { BrandMark } from "./icons.tsx";

export function AuthDialog({
  onLogin,
}: {
  onLogin: (password: string, remember?: boolean) => Promise<void>;
}) {
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const pass = password.trim();
    if (pass === "") {
      return;
    }
    setBusy(true);
    setError(null);
    setInvalid(false);
    void onLogin(pass, remember)
      .catch((err: unknown) => {
        if (err instanceof SearchHttpError) {
          const authFail =
            err.body.code === "INVALID_AUTH" || err.status === 401;
          setInvalid(authFail);
          setError(authFail ? t("authInvalid") : err.body.message);
          return;
        }
        setInvalid(true);
        setError(t("loginFailed"));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="token-overlay auth-backdrop">
      <form
        className="token-prompt auth-dialog"
        role="dialog"
        aria-labelledby="token-prompt-title"
        aria-modal="true"
        onSubmit={handleSubmit}
      >
        <div className="token-prompt-brand">
          <BrandMark />
          <span>{t("appTitle")}</span>
        </div>
        <h2 id="token-prompt-title" className="auth-dialog-title">
          {t("loginTitle")}
        </h2>
        <label className="token-prompt-label" htmlFor="web-grep-password">
          {t("passwordLabel")}
        </label>
        <input
          id="web-grep-password"
          className={invalid ? "invalid" : undefined}
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          aria-invalid={invalid}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (invalid) {
              setInvalid(false);
              setError(null);
            }
          }}
        />
        {error !== null ? (
          <p className="token-prompt-error auth-error">{error}</p>
        ) : null}
        <label className="token-prompt-remember">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(event) => {
              setRemember(event.target.checked);
            }}
          />
          {t("rememberMe")}
        </label>
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? (
            <>
              <span className="auth-spinner" aria-hidden="true" />
              {t("loginBusy")}
            </>
          ) : (
            t("loginSubmit")
          )}
        </button>
      </form>
    </div>
  );
}
