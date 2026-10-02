import type { SseHit } from "@web-grep/shared";
import {
  forwardRef,
  memo,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_HL_OPTS,
  HL_TONES,
  type HlOpts,
  type HlSpan,
  type HlTermInput,
  highlightSpans,
} from "../highlight.ts";
import { useLocale } from "../hooks/useLocale.ts";
import {
  clipLogLine,
  clipResultSnippets,
  EXPAND_CAP,
  expandLogLine,
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

function lineAnchors(
  text: string,
  terms: HlTermInput[],
  opts: HlOpts,
  matches: Array<{ start: number; end: number }>,
): { spans: HlSpan[]; anchors: Array<{ start: number; end: number }> } {
  const spans = highlightSpans(text, terms, opts, matches);
  // Server offsets stay in the window even when term paints miss (invalid
  // regex, word boundaries). Term spans still pull in the other hits.
  const anchors = matches.some((match) => match.end > match.start)
    ? [...matches, ...spans]
    : spans;
  return { spans, anchors };
}

export const LogLineText = forwardRef<
  HTMLSpanElement,
  {
    text: string;
    matches?: Array<{ start: number; end: number }>;
    terms?: HlTermInput[];
    opts?: HlOpts;
  }
>(function LogLineText(
  { text, matches = [], terms = [], opts = DEFAULT_HL_OPTS },
  ref,
) {
  const { spans, anchors } = lineAnchors(text, terms, opts, matches);
  const clips = clipLogLine(text, anchors);
  const lead = (clips[0]?.start ?? 0) > 0;
  const trail = (clips.at(-1)?.end ?? 0) < text.length;
  return (
    <span className="result-text" ref={ref}>
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
});

export function ExpandedLogLine({
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
  const { locale, t } = useLocale();
  const { spans, anchors } = lineAnchors(text, terms, opts, matches);
  const pieces = expandLogLine(text, anchors);
  return (
    <span className="result-text">
      {pieces.map((piece, index) => {
        if (piece.kind === "skip") {
          const label = t("resultExpandSkip", {
            n: piece.omitted.toLocaleString(locale),
          });
          return (
            <span key={`s${index}`} className="result-snip-skip">
              {`··· ${label} ···`}
            </span>
          );
        }
        const slice = text.slice(piece.start, piece.end);
        return (
          <span key={`${piece.start}-${piece.end}`}>
            {paintText(slice, shiftSpans(spans, piece.start, piece.end))}
          </span>
        );
      })}
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

export const ResultHitButton = memo(function ResultHitButton({
  hit,
  index,
  selected,
  open,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onSelect,
  onTruncation,
}: {
  hit: SseHit;
  index: number;
  selected: boolean;
  open: boolean;
  terms?: HlTermInput[];
  opts?: HlOpts;
  onSelect: (index: number) => void;
  onTruncation: (index: number, truncated: boolean) => void;
}) {
  const { locale, t } = useLocale();
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState<boolean | null>(null);
  const count = hit.text.length.toLocaleString(locale);

  useLayoutEffect(() => {
    const el = textRef.current;
    const read = (): void => {
      if (open) {
        // Remounted virtual rows lose local state. An open row is truncated.
        setTruncated((prev) => (prev === true ? prev : true));
        onTruncation(index, true);
        return;
      }
      if (el === null) {
        return;
      }
      const next = el.scrollHeight > el.clientHeight + 1;
      setTruncated((prev) => (prev === next ? prev : next));
      onTruncation(index, next);
    };
    read();
    if (open || el === null || typeof ResizeObserver !== "function") {
      return;
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hit.text, index, onTruncation, open]);

  const className = [
    "result-log",
    selected ? "selected" : "",
    open ? "is-open" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <button
      type="button"
      role="listitem"
      data-hit-index={index}
      data-truncated={truncated === null ? undefined : truncated ? "1" : "0"}
      className={className}
      aria-current={selected ? "true" : undefined}
      aria-expanded={truncated === true ? open : undefined}
      onClick={() => {
        onSelect(index);
      }}
    >
      <span className="result-loc" style={{ display: "none" }}>
        {`${hit.path}:${hit.line}`}
      </span>
      <span className="result-line-pill">{hit.line}</span>
      <span className="result-log-main">
        {open ? (
          <ExpandedLogLine
            text={hit.text}
            matches={hit.matches}
            terms={terms}
            opts={opts}
          />
        ) : (
          <LogLineText
            ref={textRef}
            text={hit.text}
            matches={hit.matches}
            terms={terms}
            opts={opts}
          />
        )}
        {truncated === true && !open ? (
          <span className="result-lenchip">
            {t("resultLongLine", { n: count })}
          </span>
        ) : null}
        {open ? (
          <span className="result-xnote">
            <b>{t("resultFullLine", { n: count })}</b>
            {hit.text.length > EXPAND_CAP ? (
              <span className="result-xnote-cut">
                {t("resultExpandCapNote")}
              </span>
            ) : null}
            <span className="result-xnote-gap" />
            <span className="result-xnote-hint">{t("resultExpandHint")}</span>
          </span>
        ) : null}
      </span>
    </button>
  );
});
