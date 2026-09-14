import { useCallback, useEffect, useState } from "react";
import {
  bootTheme,
  readStoredTheme,
  setActiveTheme,
  systemPrefersDark,
  type Theme,
  toggleTheme,
} from "../theme.ts";

export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(() =>
    bootTheme({
      storage: localStorage,
      prefersDark: systemPrefersDark(),
    }),
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      if (readStoredTheme() !== null) {
        return;
      }
      setThemeState(
        bootTheme({
          storage: localStorage,
          prefersDark: media.matches,
        }),
      );
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setActiveTheme(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next = toggleTheme(current);
      setActiveTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
