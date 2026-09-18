/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  apiUrl,
  normalizePublicPath,
  PUBLIC_PATH_MARKER,
  PUBLIC_PATH_META,
  readPublicPath,
} from "../api/base.ts";

describe("api public path", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("treats empty, slash, and the html marker as no prefix", () => {
    expect(normalizePublicPath("")).toBe("");
    expect(normalizePublicPath("/")).toBe("");
    expect(normalizePublicPath(PUBLIC_PATH_MARKER)).toBe("");
    expect(normalizePublicPath(" /web-grep/ ")).toBe("/web-grep");
    expect(normalizePublicPath("web-grep")).toBe("/web-grep");
  });

  it("prefixes api urls from the injected meta tag", () => {
    expect(apiUrl("/api/search")).toBe("/api/search");
    const meta = document.createElement("meta");
    meta.setAttribute("name", PUBLIC_PATH_META);
    meta.setAttribute("content", "/web-grep/");
    document.head.append(meta);
    expect(readPublicPath()).toBe("/web-grep");
    expect(apiUrl("/api/search")).toBe("/web-grep/api/search");
    expect(apiUrl("/api/file?path=a")).toBe("/web-grep/api/file?path=a");
  });
});
