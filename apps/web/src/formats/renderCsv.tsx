import type { ReactNode } from "react";
import { HighlightedText } from "../components/ResultRow.tsx";
import { DEFAULT_HL_OPTS, type HlOpts } from "../highlight.ts";

function highlightCell(text: string, terms: string[], opts: HlOpts): ReactNode {
  if (terms.length === 0) {
    return text;
  }
  return <HighlightedText text={text} terms={terms} opts={opts} />;
}

function parseRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function CsvView({
  text,
  path,
  terms = [],
  opts = DEFAULT_HL_OPTS,
}: {
  text: string;
  path: string;
  terms?: string[];
  opts?: HlOpts;
}): ReactNode {
  const delim = path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const raw = text.split(/\r?\n/).filter((line, i, arr) => {
    if (line === "" && i === arr.length - 1) {
      return false;
    }
    return true;
  });
  if (raw.length === 0) {
    return null;
  }
  const rows = raw.map((line) => parseRow(line, delim));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <div className="fmt-table-wrap">
      <table className="fmt-table">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i}>{highlightCell(cell, terms, opts)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {header.map((_, ci) => (
                <td key={ci}>{highlightCell(row[ci] ?? "", terms, opts)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
