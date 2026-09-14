/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { readToken, TOKEN_STORAGE_KEY, writeToken } from "../api/headers.ts";

describe("token persist", () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("reads localStorage before sessionStorage", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "local-tok");
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "sess-tok");
    expect(readToken()).toBe("local-tok");
  });

  it("remember writes localStorage and clears sessionStorage", () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, "old");
    writeToken("kept", "local");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("kept");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(readToken()).toBe("kept");
  });

  it("session persist does not survive a localStorage-only store", () => {
    writeToken("tab", "session");
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe("tab");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(readToken()).toBe("tab");
  });

  it("clears both stores", () => {
    writeToken("a", "local");
    writeToken("b", "session");
    writeToken("");
    expect(readToken()).toBe("");
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
