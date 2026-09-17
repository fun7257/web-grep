import { HighlightedText } from "./ResultRow.tsx";
import { detectLineKind } from "../formats/detect.ts";
import { JsonView } from "../formats/renderJson.tsx";
import { MarkdownView } from "../formats/renderMarkdown.tsx";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";

export function FormattedLine({
  path,
  text,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  path: string;
  text: string;
  terms?: import("../highlight.ts").HlTermInput[];
  opts?: HlOpts;
}) {
  const kind = detectLineKind(path, text);
  if (kind === "markdown") {
    return <MarkdownView text={text} terms={terms} opts={opts} />;
  }
  if (kind === "json") {
    const view = JsonView({ text: text.trim(), terms, opts });
    if (view !== null) {
      return view;
    }
  }
  return <HighlightedText text={text} terms={terms} opts={opts} />;
}
