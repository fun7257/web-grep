import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createT,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  type Translate,
} from "../i18n/index.ts";

type LocaleApi = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const LocaleContext = createContext<LocaleApi | null>(null);

export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // private mode / missing storage
  }
  return "zh-CN";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore quota / private mode
    }
    document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useMemo(() => createT(locale), [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale(): LocaleApi {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error("useLocale requires LocaleProvider");
  }
  return ctx;
}
