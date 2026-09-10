import type { RgMatch } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown): string | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  return typeof rec.text === "string" ? rec.text : undefined;
}

function submatchesOf(value: unknown): Array<{ start: number; end: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Array<{ start: number; end: number }> = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    if (typeof rec.start !== "number" || typeof rec.end !== "number") {
      continue;
    }
    if (!Number.isFinite(rec.start) || !Number.isFinite(rec.end)) {
      continue;
    }
    out.push({ start: rec.start, end: rec.end });
  }
  return out;
}

export function parseRgMatchLine(line: string): RgMatch | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (!rec || rec.type !== "match") {
    return undefined;
  }
  const data = asRecord(rec.data);
  if (!data) {
    return undefined;
  }
  const path = textField(data.path);
  if (path === undefined) {
    return undefined;
  }
  const text = textField(data.lines);
  if (text === undefined) {
    return undefined;
  }
  if (typeof data.line_number !== "number" || data.line_number < 1) {
    return undefined;
  }
  return {
    path,
    line: data.line_number,
    text,
    submatches: submatchesOf(data.submatches),
  };
}
