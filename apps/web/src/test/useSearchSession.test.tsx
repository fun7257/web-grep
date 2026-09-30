/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { SearchRequestInput } from "@web-grep/shared";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../hooks/useLocale.ts";
import { useSearchSession } from "../hooks/useSearchSession.ts";
import { newPart } from "../searchStack.ts";

function wrapper({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

function setup(overrides: { searchLocked?: boolean } = {}) {
  const runSearch = vi.fn<(input: SearchRequestInput) => void>();
  const record = vi.fn();
  const showInfoCue = vi.fn();
  const onStart = vi.fn();
  const hook = renderHook(
    () =>
      useSearchSession({
        timeRange: null,
        picks: [],
        excludeGlobs: "",
        runSearch,
        record,
        showInfoCue,
        onStart,
        searchLocked: overrides.searchLocked ?? false,
      }),
    { wrapper },
  );
  return { ...hook, runSearch, record, showInfoCue, onStart };
}

describe("useSearchSession", () => {
  it("sends the head row as query and the rest as filterTerms", () => {
    const { result, runSearch, record, onStart } = setup();
    act(() => {
      result.current.searchWithParts([
        newPart("  head  "),
        newPart("second", { regex: true }),
        newPart("   "),
      ]);
    });
    expect(runSearch).toHaveBeenCalledTimes(1);
    const req = runSearch.mock.calls[0]?.[0];
    expect(req?.query).toBe("head");
    expect(req?.filterTerms).toEqual([
      { query: "second", regex: true, caseSensitive: false, wordMatch: false },
    ]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(result.current.lastStack?.parts.map((part) => part.value)).toEqual([
      "head",
      "second",
    ]);
    expect(result.current.fields.map((part) => part.value)).toEqual([
      "head",
      "second",
    ]);
  });

  it("ignores a search with no non-empty rows", () => {
    const { result, runSearch, record } = setup();
    act(() => {
      result.current.searchWithParts([newPart("  ")]);
    });
    expect(runSearch).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(result.current.lastStack).toBeNull();
  });

  it("repeats the last search when the draft is empty", () => {
    const { result, runSearch } = setup();
    act(() => {
      result.current.searchWithParts([newPart("again")]);
    });
    act(() => {
      result.current.setFields([newPart("")]);
    });
    act(() => {
      result.current.submit();
    });
    expect(runSearch).toHaveBeenCalledTimes(2);
    expect(runSearch.mock.calls[1]?.[0].query).toBe("again");
  });

  it("does not submit while search is locked", () => {
    const { result, runSearch } = setup({ searchLocked: true });
    act(() => {
      result.current.setFields([newPart("blocked")]);
    });
    act(() => {
      result.current.submit();
      result.current.searchSelected("blocked");
    });
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("keeps the head row modifiers when searching a picked text", () => {
    const { result, runSearch } = setup();
    act(() => {
      result.current.setFields([newPart("x", { caseSensitive: true })]);
    });
    act(() => {
      result.current.searchSelected("picked");
    });
    const req = runSearch.mock.calls[0]?.[0];
    expect(req?.query).toBe("picked");
    expect(req?.caseSensitive).toBe(true);
  });

  it("drops the draft and the last stack on resetDraft", () => {
    const { result } = setup();
    act(() => {
      result.current.searchWithParts([newPart("gone")]);
    });
    act(() => {
      result.current.resetDraft();
    });
    expect(result.current.lastStack).toBeNull();
    expect(result.current.fields.map((part) => part.value)).toEqual([""]);
  });
});
