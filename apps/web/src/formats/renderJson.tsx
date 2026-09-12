import type { ReactNode } from "react";

function colorize(value: unknown, indent: number): ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null) {
    return <span className="tok-null">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="tok-bool">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="tok-num">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <span className="tok-str">{JSON.stringify(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map((item, i) => (
      <div key={i}>
        {pad}  {colorize(item, indent + 1)}
        {i < value.length - 1 ? "," : ""}
      </div>
    ));
    return (
      <>
        {"[\n"}
        {items}
        {pad}
        {"]"}
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }
    const items = entries.map(([k, v], i) => (
      <div key={k}>
        {pad}  <span className="tok-key">{JSON.stringify(k)}</span>
        {": "}
        {colorize(v, indent + 1)}
        {i < entries.length - 1 ? "," : ""}
      </div>
    ));
    return (
      <>
        {"{\n"}
        {items}
        {pad}
        {"}"}
      </>
    );
  }
  return JSON.stringify(value);
}

export function JsonView({ text }: { text: string }): ReactNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return <pre className="fmt-json">{colorize(parsed, 0)}</pre>;
}
