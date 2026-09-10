import { enUS } from "./en-US.ts";
import type { MsgKey } from "./keys.ts";
import { zhCN } from "./zh-CN.ts";

export type { MsgKey } from "./keys.ts";

export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "web-grep.locale";

export const catalogs: Record<Locale, Record<MsgKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined ? whole : String(value);
  });
}

export type Translate = (
  key: MsgKey,
  vars?: Record<string, string | number>,
) => string;

export function createT(locale: Locale): Translate {
  const catalog = catalogs[locale];
  return (key, vars) => {
    const template = catalog[key];
    if (vars === undefined) {
      return template;
    }
    return interpolate(template, vars);
  };
}
