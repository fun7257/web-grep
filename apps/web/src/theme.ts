export const THEME_STORAGE_KEY = "web-grep.theme.v1";
export const THEME_ATTR = "data-theme";

export type Theme = "light" | "dark";

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

export function readStoredTheme(
  storage: Pick<Storage, "getItem"> = localStorage,
): Theme | null {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(THEME_STORAGE_KEY, theme);
}

export function systemPrefersDark(
  media: Pick<Window, "matchMedia"> | undefined = globalThis.window,
): boolean {
  if (media === undefined || typeof media.matchMedia !== "function") {
    return true;
  }
  return media.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(opts: {
  stored: Theme | null;
  prefersDark: boolean;
}): Theme {
  if (opts.stored !== null) {
    return opts.stored;
  }
  return opts.prefersDark ? "dark" : "light";
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute(THEME_ATTR, theme);
  root.style.colorScheme = theme;
}

export function toggleTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

export function bootTheme(opts?: {
  storage?: Pick<Storage, "getItem">;
  prefersDark?: boolean;
  root?: HTMLElement;
}): Theme {
  const stored = readStoredTheme(opts?.storage);
  const prefersDark = opts?.prefersDark ?? systemPrefersDark();
  const theme = resolveTheme({ stored, prefersDark });
  applyTheme(theme, opts?.root ?? document.documentElement);
  return theme;
}

export function setActiveTheme(
  theme: Theme,
  opts?: {
    storage?: Pick<Storage, "setItem">;
    root?: HTMLElement;
  },
): Theme {
  persistTheme(theme, opts?.storage);
  applyTheme(theme, opts?.root ?? document.documentElement);
  return theme;
}
