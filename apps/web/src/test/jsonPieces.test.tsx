/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildJsonPieces,
  compactFromPieces,
  JSON_INDENT,
  mapCompactToOriginal,
  mappedSelection,
} from "../formats/jsonPieces.ts";
import { JsonView } from "../formats/renderJson.tsx";
import { highlightSpans } from "../highlight.ts";

describe("buildJsonPieces", () => {
  it("marks pretty whitespace as injected and keeps source tokens", () => {
    const original = '{"category":"joseKeyFail"}';
    const pieces = buildJsonPieces(original);
    expect(pieces).not.toBeNull();
    expect(compactFromPieces(pieces ?? [])).toBe(original);
    expect(pieces?.some((piece) => piece.kind === "inj")).toBe(true);
    const pretty = (pieces ?? []).map((piece) => piece.text).join("");
    expect(pretty).toBe(JSON.stringify(JSON.parse(original), null, JSON_INDENT));
    expect(pretty).toContain("\n    \"");
  });

  it("maps a compact selection back onto compact source", () => {
    const original = '{"category":"joseKeyFail","message":"x"}';
    const mapped = mapCompactToOriginal('"category":"joseKeyFail"', original);
    expect(mapped).toBe('"category":"joseKeyFail"');
  });

  it("maps compact selection onto pretty source including original spaces", () => {
    const original = '{ "category" : "joseKeyFail" }';
    const mapped = mapCompactToOriginal('"category":"joseKeyFail"', original);
    expect(mapped).toBe('"category" : "joseKeyFail"');
  });

  it("places highlights on source token ranges after pretty print", () => {
    const original = '{"category":"joseKeyFail"}';
    const pieces = buildJsonPieces(original) ?? [];
    const spans = highlightSpans(original, ["joseKeyFail"], {
      caseSensitive: false,
      wordMatch: false,
      regex: false,
    });
    expect(spans.length).toBeGreaterThan(0);
    const hit = pieces.find(
      (piece) =>
        piece.kind === "src" &&
        piece.srcStart !== undefined &&
        piece.srcEnd !== undefined &&
        piece.srcStart <= (spans[0]?.start ?? -1) &&
        piece.srcEnd >= (spans[0]?.end ?? 9999),
    );
    expect(hit?.text).toContain("joseKeyFail");
    expect(hit?.tok).toBe("str");
  });

  it("strips injected pretty whitespace from a DOM selection", () => {
    const original = '{"category":"joseKeyFail"}';
    const { container } = render(
      <JsonView text={original} terms={["joseKeyFail"]} />,
    );
    const pre = container.querySelector(".fmt-json");
    expect(pre).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(pre as Node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(mappedSelection(pre as HTMLElement, original)).toBe(original);
    expect(pre?.querySelector("mark")?.textContent).toBe("joseKeyFail");
  });
});
