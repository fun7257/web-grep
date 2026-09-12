import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import {
  DEFAULT_HL_OPTS,
  HL_TONES,
  type HlOpts,
  spansForQuery,
} from "../highlight.ts";

function markHtmlText(html: string, terms: string[], opts: HlOpts): string {
  if (terms.length === 0) {
    return html;
  }
  return html
    .split(/(<[^>]+>)/)
    .map((chunk) => {
      if (chunk.startsWith("<")) {
        return chunk;
      }
      const spans = spansForQuery(chunk, terms, opts);
      if (spans.length === 0) {
        return chunk;
      }
      let out = "";
      let cursor = 0;
      for (const span of spans) {
        out += chunk.slice(cursor, span.start);
        out += `<mark class="hl-${span.tone % HL_TONES}">${chunk.slice(span.start, span.end)}</mark>`;
        cursor = span.end;
      }
      out += chunk.slice(cursor);
      return out;
    })
    .join("");
}

export function MarkdownView({
  text,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  terms?: string[];
  opts?: HlOpts;
}) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true }) as string;
    const clean = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["mark"],
      ADD_ATTR: ["class"],
    });
    return markHtmlText(clean, terms, opts);
  }, [opts, terms, text]);
  return <div className="fmt-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
