export function HtmlView({ text }: { text: string }) {
  return (
    <iframe
      className="fmt-html"
      title="HTML preview"
      sandbox=""
      srcDoc={text}
    />
  );
}
