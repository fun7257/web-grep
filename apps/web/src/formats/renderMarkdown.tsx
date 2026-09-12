import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

export function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false, gfm: true }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [text]);
  return (
    <div className="fmt-md" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
