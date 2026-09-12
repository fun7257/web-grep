import { detectLineKind } from "../formats/detect.ts";
import { CsvView } from "../formats/renderCsv.tsx";
import { HtmlView } from "../formats/renderHtml.tsx";
import { JsonView } from "../formats/renderJson.tsx";
import { MarkdownView } from "../formats/renderMarkdown.tsx";

export function FormattedLine({
  path,
  text,
}: {
  path: string;
  text: string;
}) {
  const kind = detectLineKind(path, text);
  if (kind === "markdown") {
    return <MarkdownView text={text} />;
  }
  if (kind === "json") {
    const view = JsonView({ text: text.trim() });
    if (view !== null) {
      return view;
    }
  }
  if (kind === "csv") {
    return <CsvView text={text} path={path} />;
  }
  if (kind === "html") {
    return <HtmlView text={text} />;
  }
  return null;
}
