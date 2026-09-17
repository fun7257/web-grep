export const HL_TONES = 4;

export type HlOpts = {
  caseSensitive: boolean;
  wordMatch: boolean;
  regex: boolean;
};

export type HlTerm = {
  value: string;
  caseSensitive?: boolean;
  wordMatch?: boolean;
  regex?: boolean;
};

export type HlTermInput = string | HlTerm;

function termValue(term: HlTermInput): string {
  return typeof term === "string" ? term : term.value;
}

function termOpts(term: HlTermInput, fallback: HlOpts): HlOpts {
  if (typeof term === "string") {
    return fallback;
  }
  return {
    caseSensitive: term.caseSensitive ?? fallback.caseSensitive,
    wordMatch: term.wordMatch ?? fallback.wordMatch,
    regex: term.regex ?? fallback.regex,
  };
}

export type HlSpan = {
  start: number;
  end: number;
  tone: number;
};

export const DEFAULT_HL_OPTS: HlOpts = {
  caseSensitive: false,
  wordMatch: false,
  regex: false,
};

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allRegex(text: string, re: RegExp): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let match = global.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end > start) {
      out.push([start, end]);
      global.lastIndex = end;
    } else {
      global.lastIndex += 1;
    }
    match = global.exec(text);
  }
  return out;
}

function allLiteral(
  text: string,
  term: string,
  caseSensitive: boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  if (needle === "") {
    return out;
  }
  let from = 0;
  while (from < hay.length) {
    const at = hay.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    out.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return out;
}

function locateTerm(
  text: string,
  term: string,
  opts: HlOpts,
): Array<[number, number]> {
  const flags = opts.caseSensitive ? "g" : "gi";
  if (opts.regex) {
    try {
      const source = opts.wordMatch ? `\\b(?:${term})\\b` : term;
      return allRegex(text, new RegExp(source, flags));
    } catch {
      // invalid regex, fall through to literal
    }
  }
  if (opts.wordMatch) {
    try {
      return allRegex(text, new RegExp(`\\b${escapeRegExp(term)}\\b`, flags));
    } catch {
      // ignore and use literal
    }
  }
  return allLiteral(text, term, opts.caseSensitive);
}

export function flattenSpans(length: number, spans: HlSpan[]): HlSpan[] {
  if (length === 0 || spans.length === 0) {
    return [];
  }
  const paint = new Int8Array(length);
  paint.fill(-1);
  const ordered = [...spans].sort((a, b) => a.tone - b.tone);
  for (const span of ordered) {
    const start = Math.max(0, span.start);
    const end = Math.min(length, span.end);
    for (let i = start; i < end; i++) {
      if (paint[i] === -1) {
        paint[i] = span.tone;
      }
    }
  }
  const out: HlSpan[] = [];
  let i = 0;
  while (i < length) {
    const tone = paint[i] ?? -1;
    if (tone < 0) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < length && paint[j] === tone) {
      j += 1;
    }
    out.push({ start: i, end: j, tone });
    i = j;
  }
  return out;
}

export function spansForQuery(
  text: string,
  terms: HlTermInput[],
  opts: HlOpts = DEFAULT_HL_OPTS,
): HlSpan[] {
  const found: HlSpan[] = [];
  terms.forEach((raw, index) => {
    const term = termValue(raw).trim();
    if (term === "") {
      return;
    }
    const tone = index % HL_TONES;
    for (const [start, end] of locateTerm(text, term, termOpts(raw, opts))) {
      found.push({ start, end, tone });
    }
  });
  return flattenSpans(text.length, found);
}

export function spansFromOffsets(
  text: string,
  matches: Array<{ start: number; end: number; tone?: number }>,
): HlSpan[] {
  const found: HlSpan[] = [];
  for (const match of matches) {
    const start = Math.min(Math.max(0, match.start), text.length);
    const end = Math.min(Math.max(start, match.end), text.length);
    if (end > start) {
      found.push({
        start,
        end,
        tone:
          "tone" in match && typeof match.tone === "number" ? match.tone : 0,
      });
    }
  }
  return flattenSpans(text.length, found);
}

export function highlightSpans(
  text: string,
  terms: HlTermInput[],
  opts: HlOpts = DEFAULT_HL_OPTS,
  fallback: Array<{ start: number; end: number }> = [],
): HlSpan[] {
  const cleaned = terms.filter((item) => termValue(item).trim() !== "");
  if (cleaned.length > 0) {
    return spansForQuery(text, cleaned, opts);
  }
  return spansFromOffsets(text, fallback);
}
