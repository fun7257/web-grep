import type { ReactNode } from "react";
import { HighlightedText } from "../components/ResultRow.tsx";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";

function highlightChunk(
  text: string,
  terms: string[],
  opts: HlOpts,
): ReactNode {
  if (terms.length === 0) {
    return text;
  }
  return <HighlightedText text={text} terms={terms} opts={opts} />;
}

function colorize(
  value: unknown,
  indent: number,
  terms: string[],
  opts: HlOpts,
): ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null) {
    return <span className="tok-null">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="tok-bool">
        {highlightChunk(String(value), terms, opts)}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="tok-num">
        {highlightChunk(String(value), terms, opts)}
      </span>
    );
  }
  if (typeof value === "string") {
    return (
      <span className="tok-str">
        {highlightChunk(JSON.stringify(value), terms, opts)}
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map((item, i) => (
      <div key={i}>
        {pad} {colorize(item, indent + 1, terms, opts)}
        {i < value.length - 1 ? "," : ""}
      </div>
    ));
    return (
      <>
        {"[\n"}
        {items}
        {pad}
        {"]"}
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    const items = entries.map(([k, v], i) => (
      <div key={k}>
        {pad}{" "}
        <span className="tok-key">
          {highlightChunk(JSON.stringify(k), terms, opts)}
        </span>
        {": "}
        {colorize(v, indent + 1, terms, opts)}
        {i < entries.length - 1 ? "," : ""}
      </div>
    ));
    return (
      <>
        {"{\n"}
        {items}
        {pad}
        {"}"}
      </>
    );
  }
  return JSON.stringify(value);
}

export function JsonView({
  text,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  terms?: string[];
  opts?: HlOpts;
}): ReactNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return <pre className="fmt-json">{colorize(parsed, 0, terms, opts)}</pre>;
}
