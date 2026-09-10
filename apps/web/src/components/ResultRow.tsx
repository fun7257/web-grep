import type { SseHit } from "@web-grep/shared";
import { type ReactNode } from "react";

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

export function ResultRow({
  hit,
  selected,
  onSelect,
}: {
  hit: SseHit;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      className={selected ? "result-row selected" : "result-row"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="result-loc">
        {hit.path}:{hit.line}
      </span>
      <span className="result-text">
        <HighlightedText text={hit.text} matches={hit.matches} />
      </span>
    </button>
  );
}
