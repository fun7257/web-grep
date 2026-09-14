import { describe, expect, it } from "vitest";
import { buildShareUrl, parseShareSearch } from "../searchShare.ts";

describe("parseShareSearch", () => {
  it("returns null without a query", () => {
    expect(parseShareSearch("")).toBeNull();
    expect(parseShareSearch("p=src/a.ts")).toBeNull();
  });

  it("reads stacked terms and a hit location", () => {
    expect(parseShareSearch("?q=hello&q=world&p=src/a.ts&n=12&s=1&t=7d")).toEqual({
      parts: ["hello", "world"],
      caseSensitive: true,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 12,
      timeRange: "7d",
    });
  });
});

describe("buildShareUrl", () => {
  it("writes a round-trippable link", () => {
    const href = buildShareUrl("http://127.0.0.1:5173/", {
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 1,
    });
    expect(href).toBe("http://127.0.0.1:5173/?q=hello&p=src%2Fa.ts&n=1");
    expect(parseShareSearch(new URL(href).search)).toEqual({
      parts: ["hello"],
      caseSensitive: false,
      wordMatch: false,
      regex: false,
      path: "src/a.ts",
      line: 1,
    });
  });
});
