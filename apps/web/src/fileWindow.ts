export type WindowLine = { n: number; text: string };

export function mergeLines(
  current: WindowLine[],
  incoming: WindowLine[],
): WindowLine[] {
  if (incoming.length === 0) {
    return current;
  }
  const byN = new Map<number, WindowLine>();
  for (const line of current) {
    byN.set(line.n, line);
  }
  for (const line of incoming) {
    byN.set(line.n, line);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

export function rangeForLine(
  line: number,
  chunk: number,
  maxCount: number = chunk,
): { from: number; count: number } {
  const cap = Math.max(1, Math.floor(maxCount));
  const size = Math.min(Math.max(1, Math.floor(chunk)), cap);
  if (!Number.isInteger(line) || line <= 1) {
    return { from: 1, count: size };
  }
  const leadWanted = Math.min(size, line - 1);
  let count = leadWanted + size;
  if (count > cap) {
    const lead = Math.min(leadWanted, cap - 1);
    return { from: line - lead, count: cap };
  }
  return { from: line - leadWanted, count };
}

export function parseGotoLine(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    return null;
  }
  return n;
}

export function pickGotoLine(
  lines: WindowLine[],
  requested: number,
): number | null {
  if (lines.length === 0) {
    return null;
  }
  const exact = lines.find((line) => line.n === requested);
  if (exact !== undefined) {
    return exact.n;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (last !== undefined && requested > last.n) {
    return last.n;
  }
  if (first !== undefined && requested < first.n) {
    return first.n;
  }
  let best = first ?? last;
  if (best === undefined) {
    return null;
  }
  for (const line of lines) {
    if (Math.abs(line.n - requested) < Math.abs(best.n - requested)) {
      best = line;
    }
  }
  return best.n;
}
