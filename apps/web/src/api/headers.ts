export const TOKEN_STORAGE_KEY = "web-grep.token";

export function readToken(): string {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
}

export function writeToken(token: string): void {
  if (token === "") {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** Token lives in sessionStorage only — never localStorage or the URL. */
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
