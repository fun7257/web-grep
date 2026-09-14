export const TOKEN_STORAGE_KEY = "web-grep.token";

export type TokenPersist = "session" | "local";

export function readToken(): string {
  return (
    localStorage.getItem(TOKEN_STORAGE_KEY) ??
    sessionStorage.getItem(TOKEN_STORAGE_KEY) ??
    ""
  );
}

export function writeToken(
  token: string,
  persist: TokenPersist = "session",
): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  if (token === "") {
    return;
  }
  const store = persist === "local" ? localStorage : sessionStorage;
  store.setItem(TOKEN_STORAGE_KEY, token);
}

export function apiHeaders(): Record<string, string> {
  const token = readToken();
  if (token === "") {
    return {};
  }
  return {
    "X-Web-Grep-Token": token,
    Authorization: `Bearer ${token}`,
  };
}
