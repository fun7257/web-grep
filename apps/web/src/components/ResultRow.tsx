import type { SseHit } from "@web-grep/shared";
import { memo, type ReactNode } from "react";
import { FileIcon } from "./icons.tsx";

type MatchSpan = { start: number; end: number };

function clampMatches(text: string, matches: MatchSpan[]): MatchSpan[] {
  const clamped: MatchSpan[] = [];
  for (const match of matches) {
    const start = Math.min(Math.max(0, match.start), text.length);
    const end = Math.min(Math.max(start, match.end), text.length);
    if (end > start) {
      clamped.push({ start, end });
    }
  }
  clamped.sort((a, b) => a.start - b.start);
  return clamped;
}

export function HighlightedText({
  text,
  matches,
}: {
  text: string;
  matches: MatchSpan[];
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let part = 0;
  for (const match of clampMatches(text, matches)) {
    if (match.start < cursor) {
      continue;
    }
    if (match.start > cursor) {
      parts.push(
        <span key={`t${part}`}>{text.slice(cursor, match.start)}</span>,
      );
      part += 1;
    }
    parts.push(
      <mark key={`m${part}`}>{text.slice(match.start, match.end)}</mark>,
    );
    part += 1;
    cursor = match.end;
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
}: {
  hit: SseHit;
  selected: boolean;
  index: number;
  onSelect: (index: number) => void;
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
        <HighlightedText text={hit.text} matches={hit.matches} />
      </span>
    </button>
  );
});
