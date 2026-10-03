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
import { CROSSFADE_MS, collapseHeadDiffers } from "../resultExpandMotion.ts";
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

/**
 * Two-line clamp. Lengths outside this band are obvious at the result-list
 * width; the layout effect still corrects the middle.
 */
function seedTruncation(text: string): boolean | null {
  if (text.length >= 400) {
    return true;
  }
  if (text.length <= 40) {
    return false;
  }
  return null;
}

export const ResultHitButton = memo(function ResultHitButton({
  hit,
  index,
  selected,
  open,
  holdHeight = null,
  terms = [],
  opts = DEFAULT_HL_OPTS,
  onSelect,
  onTruncation,
}: {
  hit: SseHit;
  index: number;
  selected: boolean;
  open: boolean;
  /** Collapsed layout box while the expanded text is still on screen. */
  holdHeight?: number | null;
  terms?: HlTermInput[];
  opts?: HlOpts;
  onSelect: (index: number) => void;
  /** `remeasure` is set when this paint did not already show `truncated`. */
  onTruncation: (
    index: number,
    truncated: boolean,
    remeasure: boolean,
  ) => void;
}) {
  const { locale, t } = useLocale();
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState<boolean | null>(() =>
    seedTruncation(hit.text),
  );
  const count = hit.text.length.toLocaleString(locale);
  const holding = holdHeight != null && !open;
  const expanded = open || holding;
  const heldRef = useRef(false);

  useLayoutEffect(() => {
    const wasHolding = heldRef.current;
    heldRef.current = holding;
    if (!wasHolding || holding || open) {
      return;
    }
    const { anchors } = lineAnchors(hit.text, terms, opts, hit.matches ?? []);
    if (!collapseHeadDiffers(hit.text, anchors)) {
      return;
    }
    const node = textRef.current;
    if (node === null || typeof node.animate !== "function") {
      return;
    }
    const anim = node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: CROSSFADE_MS,
      easing: "ease-out",
      fill: "both",
    });
    anim.oncancel = null;
    anim.onfinish = () => {
      anim.onfinish = null;
      anim.cancel();
    };
    return () => {
      anim.onfinish = null;
      anim.oncancel = null;
      anim.cancel();
    };
  }, [hit.matches, hit.text, holding, open, opts, terms]);

  useLayoutEffect(() => {
    const el = textRef.current;
    const read = (): void => {
      if (open) {
        // Remounted virtual rows lose local state. An open row is truncated.
        // Dispatch only when the painted value changes. An equal update still
        // occupies a lane, and a later switch then pays a second commit.
        if (truncated !== true) {
          setTruncated(true);
        }
        onTruncation(index, true, truncated !== true);
        return;
      }
      // Lengths outside the middle band already seeded this state. Reading
      // scrollHeight here forces a layout on every switch, before the list
      // can write its one scroll correction.
      const seeded = seedTruncation(hit.text);
      if (seeded !== null && truncated === seeded) {
        onTruncation(index, seeded, false);
        return;
      }
      if (el === null) {
        return;
      }
      const next = el.scrollHeight > el.clientHeight + 1;
      if (truncated !== next) {
        setTruncated(next);
      }
      onTruncation(index, next, truncated !== next);
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
  }, [hit.text, index, onTruncation, open, truncated]);

  const className = [
    "result-log",
    selected ? "selected" : "",
    expanded ? "is-open" : "",
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
      aria-expanded={truncated === true ? expanded : undefined}
      style={
        holding && holdHeight != null
          ? { height: holdHeight, maxHeight: holdHeight, minHeight: 0 }
          : undefined
      }
      onClick={() => {
        onSelect(index);
      }}
    >
      <span className="result-loc" style={{ display: "none" }}>
        {`${hit.path}:${hit.line}`}
      </span>
      <span className="result-line-pill">{hit.line}</span>
      <span className="result-log-main">
        {expanded ? (
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
        {truncated === true && !expanded ? (
          <span className="result-lenchip">
            {t("resultLongLine", { n: count })}
          </span>
        ) : null}
        {holding ? (
          <span className="result-lenchip is-motion">
            {t("resultLongLine", { n: count })}
          </span>
        ) : null}
        {expanded ? (
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
