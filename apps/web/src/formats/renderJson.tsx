import type { ReactNode } from "react";
import { HighlightedText } from "../components/ResultRow.tsx";
import {
  DEFAULT_HL_OPTS,
  type HlOpts,
  type HlSpan,
  highlightSpans,
} from "../highlight.ts";
import { buildJsonPieces, type JsonPiece, type JsonTok } from "./jsonPieces.ts";

const TOK_CLASS: Record<JsonTok, string> = {
  key: "tok-key",
  str: "tok-str",
  num: "tok-num",
  bool: "tok-bool",
  null: "tok-null",
  punct: "tok-punct",
};

function localSpans(
  piece: JsonPiece,
  origSpans: HlSpan[],
): Array<{ start: number; end: number; tone: number }> {
  if (
    piece.kind !== "src" ||
    piece.srcStart === undefined ||
    piece.srcEnd === undefined
  ) {
    return [];
  }
  const from = piece.srcStart;
  const to = piece.srcEnd;
  const out: Array<{ start: number; end: number; tone: number }> = [];
  for (const span of origSpans) {
    const start = Math.max(span.start, from) - from;
    const end = Math.min(span.end, to) - from;
    if (end > start) {
      out.push({ start, end, tone: span.tone });
    }
  }
  return out;
}

function renderPiece(
  piece: JsonPiece,
  index: number,
  origSpans: HlSpan[],
  terms: import("../highlight.ts").HlTermInput[],
  opts: HlOpts,
): ReactNode {
  if (piece.kind === "inj") {
    return (
      <span key={index} data-fmt="inj" className="fmt-inj">
        {piece.text}
      </span>
    );
  }
  const cls = piece.tok !== undefined ? TOK_CLASS[piece.tok] : undefined;
  const mapped = localSpans(piece, origSpans);
  let body: ReactNode = piece.text;
  if (mapped.length > 0) {
    body = <HighlightedText text={piece.text} matches={mapped} />;
  } else if (terms.length > 0) {
    body = <HighlightedText text={piece.text} terms={terms} opts={opts} />;
  }
  return (
    <span key={index} data-fmt="src" className={cls}>
      {body}
    </span>
  );
}

export function JsonView({
  text,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  terms?: import("../highlight.ts").HlTermInput[];
  opts?: HlOpts;
}): ReactNode {
  const pieces = buildJsonPieces(text);
  if (pieces === null) {
    return null;
  }
  const origSpans = highlightSpans(text, terms, opts);
  return (
    <pre className="fmt-json">
      {pieces.map((piece, index) =>
        renderPiece(piece, index, origSpans, terms, opts),
      )}
    </pre>
  );
}
