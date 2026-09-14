/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../components/StatusBar.tsx";
import { LocaleProvider } from "../hooks/useLocale.ts";
import {
  applyTheme,
  bootTheme,
  resolveTheme,
  setActiveTheme,
  THEME_ATTR,
  THEME_STORAGE_KEY,
  toggleTheme,
} from "../theme.ts";

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute(THEME_ATTR);
  document.documentElement.style.colorScheme = "";
});

describe("resolveTheme", () => {
  it("uses dark when nothing is stored and the system prefers dark", () => {
    expect(resolveTheme({ stored: null, prefersDark: true })).toBe("dark");
  });

  it("uses light when nothing is stored and the system prefers light", () => {
    expect(resolveTheme({ stored: null, prefersDark: false })).toBe("light");
  });

  it("lets a stored light theme win over system dark", () => {
    expect(resolveTheme({ stored: "light", prefersDark: true })).toBe("light");
  });
});

describe("bootTheme and setActiveTheme", () => {
  it("boots dark from system preference when storage is empty", () => {
    const theme = bootTheme({
      storage: localStorage,
      prefersDark: true,
      root: document.documentElement,
    });
    expect(theme).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
  });

  it("boots stored light even when the system prefers dark", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const theme = bootTheme({
      storage: localStorage,
      prefersDark: true,
      root: document.documentElement,
    });
    expect(theme).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("light");
  });

  it("toggle writes storage and sets the document theme attribute", () => {
    applyTheme("dark", document.documentElement);
    const next = toggleTheme("dark");
    setActiveTheme(next, {
      storage: localStorage,
      root: document.documentElement,
    });
    expect(next).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    const back = toggleTheme("light");
    setActiveTheme(back, {
      storage: localStorage,
      root: document.documentElement,
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
  });
});

describe("ThemeToggle", () => {
  it("persists the choice and sets the document theme attribute", () => {
    localStorage.setItem("web-grep.locale", "en-US");
    render(
      <LocaleProvider>
        <ThemeToggle />
      </LocaleProvider>,
    );
    const button = screen.getByRole("button", { name: "Toggle light/dark" });
    fireEvent.click(button);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("light");
    fireEvent.click(button);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTR)).toBe("dark");
  });
});
