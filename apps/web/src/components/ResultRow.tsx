import type { SseHit } from "@web-grep/shared";
import { memo, type ReactNode } from "react";
import {
  DEFAULT_HL_OPTS,
  HL_TONES,
  type HlOpts,
  highlightSpans,
} from "../highlight.ts";
import { FileIcon } from "./icons.tsx";

export function HighlightedText({
  text,
  matches = [],
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  matches?: Array<{ start: number; end: number }>;
  terms?: string[];
  opts?: HlOpts;
}) {
  const spans = highlightSpans(text, terms, opts, matches);
  const parts: ReactNode[] = [];
  let cursor = 0;
  let part = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      parts.push(
        <span key={`t${part}`}>{text.slice(cursor, span.start)}</span>,
      );
      part += 1;
    }
    parts.push(
      <mark key={`m${part}`} className={`hl-${span.tone % HL_TONES}`}>
        {text.slice(span.start, span.end)}
      </mark>,
    );
    part += 1;
    cursor = span.end;
  }
  if (cursor < text.length) {
    parts.push(<span key={`t${part}`}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

export const ResultRow = memo(function ResultRow({
  hit,
  selected,
  index,
  onSelect,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  hit: SseHit;
  selected: boolean;
  index: number;
  onSelect: (index: number) => void;
  terms?: string[];
  opts?: HlOpts;
}) {
  const slash = hit.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : hit.path.slice(0, slash + 1);
  const file = slash === -1 ? hit.path : hit.path.slice(slash + 1);
  return (
    <button
      type="button"
      role="listitem"
      className={selected ? "result-row selected" : "result-row"}
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        onSelect(index);
      }}
    >
      <div className="result-row-head">
        <FileIcon path={hit.path} />
        <span className="result-loc">
          <span className="result-dir">{dir}</span>
          <span className="result-file">{file}</span>
          <span className="result-line">{`:${hit.line}`}</span>
        </span>
      </div>
      <span className="result-text">
        <HighlightedText
          text={hit.text}
          matches={hit.matches}
          terms={terms}
          opts={opts}
        />
      </span>
    </button>
  );
});
