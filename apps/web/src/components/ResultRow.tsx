import type { SseHit } from "@web-grep/shared";
import { memo, type ReactNode } from "react";
import {
  DEFAULT_HL_OPTS,
  HL_TONES,
  type HlOpts,
  type HlSpan,
  type HlTermInput,
  highlightSpans,
} from "../highlight.ts";
import { clipLineEnd, clipResultSnippets, shiftSpans } from "../resultSnippet.ts";
import { FileIcon } from "./icons.tsx";

function paintText(text: string, spans: HlSpan[]): ReactNode {
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

export function HighlightedText({
  text,
  matches = [],
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  matches?: Array<{ start: number; end: number }>;
  terms?: HlTermInput[];
  opts?: HlOpts;
}) {
  return paintText(text, highlightSpans(text, terms, opts, matches));
}

export function LogLineText({
  text,
  matches = [],
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  matches?: Array<{ start: number; end: number }>;
  terms?: HlTermInput[];
  opts?: HlOpts;
}) {
  const clip = clipLineEnd(text);
  const slice = text.slice(clip.start, clip.end);
  const shifted = matches
    .map((match) => ({
      start: Math.max(0, match.start - clip.start),
      end: Math.min(clip.end - clip.start, match.end - clip.start),
    }))
    .filter((match) => match.end > match.start);
  return (
    <span className="result-text">
      {paintText(slice, highlightSpans(slice, terms, opts, shifted))}
    </span>
  );
}

export function ResultHitText({
  text,
  matches = [],
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  matches?: Array<{ start: number; end: number }>;
  terms?: HlTermInput[];
  opts?: HlOpts;
}) {
  const spans = highlightSpans(text, terms, opts, matches);
  const clips = clipResultSnippets(text, spans);
  const title = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  const clippedStart = (clips[0]?.start ?? 0) > 0;
  const clippedEnd = (clips.at(-1)?.end ?? 0) < text.length;
  return (
    <>
      <span className="result-text" title={title}>
        {clips.map((clip, index) => {
          const slice = text.slice(clip.start, clip.end);
          return (
            <span key={`${clip.start}-${clip.end}`}>
              {index > 0 ? (
                <span className="result-snip-skip"> ... </span>
              ) : null}
              {index === 0 && clippedStart ? (
                <span className="result-snip-skip">...</span>
              ) : null}
              {paintText(slice, shiftSpans(spans, clip.start, clip.end))}
            </span>
          );
        })}
      </span>
      {clippedEnd ? (
        <span className="result-snip-skip is-end" title="省略">
          ...
        </span>
      ) : null}
    </>
  );
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
  terms?: HlTermInput[];
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
      <ResultHitText
        text={hit.text}
        matches={hit.matches}
        terms={terms}
        opts={opts}
      />
    </button>
  );
});
