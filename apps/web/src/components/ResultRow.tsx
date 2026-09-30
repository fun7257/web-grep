import type { ReactNode } from "react";
import {
  DEFAULT_HL_OPTS,
  HL_TONES,
  type HlOpts,
  type HlSpan,
  type HlTermInput,
  highlightSpans,
} from "../highlight.ts";
import {
  clipLogLine,
  clipResultSnippets,
  shiftSpans,
} from "../resultSnippet.ts";

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
  const spans = highlightSpans(text, terms, opts, matches);
  // Server offsets stay in the window even when term paints miss (invalid
  // regex, word boundaries). Term spans still pull in the other hits.
  const anchors = matches.some((match) => match.end > match.start)
    ? [...matches, ...spans]
    : spans;
  const clips = clipLogLine(text, anchors);
  const lead = (clips[0]?.start ?? 0) > 0;
  const trail = (clips.at(-1)?.end ?? 0) < text.length;
  return (
    <span className="result-text">
      {lead ? "…" : null}
      {clips.map((clip, index) => {
        const slice = text.slice(clip.start, clip.end);
        return (
          <span key={`${clip.start}-${clip.end}`}>
            {index > 0 ? "…" : null}
            {paintText(slice, shiftSpans(spans, clip.start, clip.end))}
          </span>
        );
      })}
      {trail ? "…" : null}
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
