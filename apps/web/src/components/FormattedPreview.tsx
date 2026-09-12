import { detectLineKind } from "../formats/detect.ts";
import { CsvView } from "../formats/renderCsv.tsx";
import { HtmlView } from "../formats/renderHtml.tsx";
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
  terms?: string[];
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
  if (kind === "csv") {
    return <CsvView text={text} path={path} terms={terms} opts={opts} />;
  }
  if (kind === "html") {
    return <HtmlView text={text} />;
  }
  return null;
}
