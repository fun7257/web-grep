import { isAbsolute as nodeIsAbsolute } from "node:path";
import { LIMITS, type SseHit } from "@web-grep/shared";
import { isDenied } from "../sandbox/denylist.ts";
import { resolveUnderRoot } from "../sandbox/resolvePath.ts";
import type { RgMatch } from "./types.ts";

const utf8Encoder = new TextEncoder();

export function utf8ByteOffsetToUtf16(
  text: string,
  byteOffset: number,
): number | undefined {
  if (!Number.isFinite(byteOffset) || byteOffset < 0) {
    return undefined;
  }
  const bytes = utf8Encoder.encode(text);
  if (byteOffset > bytes.byteLength) {
    return undefined;
  }
  if (byteOffset === 0) {
    return 0;
  }
  if (byteOffset === bytes.byteLength) {
    return text.length;
  }
  try {
    const prefix = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, byteOffset),
    );
    return prefix.length;
  } catch {
    return undefined;
  }
}

function stripLineEnd(text: string): string {
  if (text.endsWith("\r\n")) {
    return text.slice(0, -2);
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return text.slice(0, -1);
  }
  return text;
}

function clampMatches(
  text: string,
  submatches: Array<{ start: number; end: number }>,
): SseHit["matches"] {
  const matches: SseHit["matches"] = [];
  for (const sub of submatches) {
    const start = utf8ByteOffsetToUtf16(text, sub.start);
    const end = utf8ByteOffsetToUtf16(text, sub.end);
    if (start === undefined || end === undefined || start > end) {
      continue;
    }
    const clampedStart = Math.min(start, text.length);
    const clampedEnd = Math.min(end, text.length);
    if (clampedStart === clampedEnd) {
      continue;
    }
    matches.push({ start: clampedStart, end: clampedEnd });
  }
  return matches;
}

export async function toRelativeHit(
  rootReal: string,
  allowSecrets: boolean,
  match: RgMatch,
): Promise<SseHit | undefined> {
  if (match.path.includes("\0")) {
    return undefined;
  }
  if (nodeIsAbsolute(match.path) || match.path.startsWith("/")) {
    return undefined;
  }
  let resolved: { abs: string; rel: string };
  try {
    resolved = await resolveUnderRoot(rootReal, match.path);
  } catch {
    return undefined;
  }
  if (isDenied(resolved.rel, allowSecrets)) {
    return undefined;
  }
  const stripped = stripLineEnd(match.text);
  const text =
    stripped.length > LIMITS.lineTextMaxChars
      ? stripped.slice(0, LIMITS.lineTextMaxChars)
      : stripped;
  return {
    path: resolved.rel,
    line: match.line,
    text,
    matches: clampMatches(match.text, match.submatches)
      .map((m) => ({
        start: Math.min(m.start, text.length),
        end: Math.min(m.end, text.length),
      }))
      .filter((m) => m.start < m.end),
  };
}
