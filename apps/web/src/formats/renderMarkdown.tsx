import DOMPurify from "dompurify";
import { useMemo } from "react";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";
import {
  annotateMarkdownHtml,
  renderMarkdownWithOffsets,
} from "./markdownPieces.ts";

export function MarkdownView({
  text,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  terms?: import("../highlight.ts").HlTermInput[];
  opts?: HlOpts;
}) {
  const html = useMemo(() => {
    const raw = renderMarkdownWithOffsets(text);
    const clean = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["mark", "span"],
      ADD_ATTR: ["class", "data-fmt", "data-md-start", "data-md-end"],
    });
    return annotateMarkdownHtml(clean, text, opts, terms);
  }, [opts, terms, text]);
  return <div className="fmt-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
