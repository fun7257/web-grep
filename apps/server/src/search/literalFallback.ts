import { opendir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { LIMITS } from "@web-grep/shared";
import picomatch from "picomatch";
import { isDenied } from "../sandbox/denylist.ts";
import { resolveUnderRoot } from "../sandbox/resolvePath.ts";
import type {
  EngineResult,
  EngineSearchInput,
  RgMatch,
  SearchEngine,
} from "./types.ts";

const MAX_DEPTH = 32;
const NUL_SNIFF_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

function posixRel(rel: string): string {
  return rel.split("\\").join("/");
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

function isHiddenRel(relPosix: string): boolean {
  return relPosix.split("/").some((seg) => isHiddenName(seg));
}

function globMatches(glob: string, relPosix: string): boolean {
  const match = picomatch(glob, { dot: true, nocase: false });
  const base = relPosix.split("/").pop() ?? relPosix;
  return match(relPosix) || match(base);
}

function globsAllow(
  relPosix: string,
  include: string[],
  exclude: string[],
): boolean {
  if (exclude.some((glob) => globMatches(glob, relPosix))) {
    return false;
  }
  if (include.length === 0) {
    return true;
  }
  return include.some((glob) => globMatches(glob, relPosix));
}

function byteOffset(line: string, charIndex: number): number {
  return encoder.encode(line.slice(0, charIndex)).byteLength;
}

function isWordBoundary(line: string, start: number, end: number): boolean {
  const left = start === 0 ? "" : line[start - 1];
  const right = end >= line.length ? "" : line[end];
  const word = /[0-9A-Za-z_]/;
  if (left && word.test(left)) {
    return false;
  }
  if (right && word.test(right)) {
    return false;
  }
  return true;
}

function findLiteralMatches(
  line: string,
  query: string,
  caseSensitive: boolean,
  wordMatch: boolean,
): Array<{ start: number; end: number }> {
  const hay = caseSensitive ? line : line.toLocaleLowerCase("en");
  const needle = caseSensitive ? query : query.toLocaleLowerCase("en");
  if (needle.length === 0) {
    return [];
  }
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) {
      break;
    }
    const end = idx + needle.length;
    if (idx <= line.length && end <= line.length) {
      if (!wordMatch || isWordBoundary(line, idx, end)) {
        out.push({
          start: byteOffset(line, idx),
          end: byteOffset(line, end),
        });
      }
    }
    from = idx + Math.max(needle.length, 1);
  }
  return out;
}

function skipDir(
  name: string,
  relPosix: string,
  input: EngineSearchInput,
): boolean {
  if (name === ".git") {
    return true;
  }
  if (isDenied(relPosix, input.allowSecrets)) {
    return true;
  }
  if (!input.hidden && isHiddenName(name)) {
    return true;
  }
  if (input.globExclude.some((glob) => globMatches(glob, relPosix))) {
    return true;
  }
  return false;
}

async function emitFileMatches(
  rootReal: string,
  relPosix: string,
  input: EngineSearchInput,
  onMatch: (match: RgMatch) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return;
  }
  if (isDenied(relPosix, input.allowSecrets)) {
    return;
  }
  if (!input.hidden && isHiddenRel(relPosix)) {
    return;
  }
  if (!globsAllow(relPosix, input.globInclude, input.globExclude)) {
    return;
  }
  let resolved: { abs: string; rel: string };
  try {
    resolved = await resolveUnderRoot(rootReal, relPosix);
  } catch {
    return;
  }
  if (isDenied(resolved.rel, input.allowSecrets)) {
    return;
  }
  let st;
  try {
    st = await stat(resolved.abs);
  } catch {
    return;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) {
    return;
  }
  let buf: Buffer;
  try {
    buf = await readFile(resolved.abs);
  } catch {
    return;
  }
  if (buf.subarray(0, Math.min(buf.byteLength, NUL_SNIFF_BYTES)).includes(0)) {
    return;
  }
  const content = buf.toString("utf8");
  const lines = content.split("\n");
  let fileCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (signal.aborted || fileCount >= LIMITS.perFileMaxCount) {
      return;
    }
    const raw = lines[i];
    if (raw === undefined) {
      continue;
    }
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const submatches = findLiteralMatches(
      line,
      input.query,
      input.caseSensitive,
      input.wordMatch,
    );
    if (submatches.length === 0) {
      continue;
    }
    await onMatch({
      path: resolved.rel === "" ? relPosix : resolved.rel,
      line: i + 1,
      text: `${line}\n`,
      submatches,
    });
    fileCount += 1;
  }
}

export class LiteralEngine implements SearchEngine {
  readonly kind = "literal" as const;

  async search(
    input: EngineSearchInput,
    onMatch: (match: RgMatch) => Promise<void>,
    signal: AbortSignal,
  ): Promise<EngineResult> {
    if (signal.aborted) {
      return { exitCode: 0 };
    }
    // Regex is refused in preflight (ENGINE_UNSUPPORTED). Do not interpret the query.
    if (input.regex) {
      return { exitCode: 0 };
    }
    const startAbs =
      input.relativeDir === "."
        ? input.rootReal
        : join(input.rootReal, input.relativeDir);
    const startRel =
      input.relativeDir === "." ? "" : posixRel(input.relativeDir);

    let startStat;
    try {
      startStat = await stat(startAbs);
    } catch {
      return { exitCode: 0 };
    }

    if (startStat.isFile()) {
      await emitFileMatches(
        input.rootReal,
        startRel === "" ? posixRel(input.relativeDir) : startRel,
        input,
        onMatch,
        signal,
      );
      return { exitCode: 0 };
    }
    if (!startStat.isDirectory()) {
      return { exitCode: 0 };
    }

    const stack: Array<{ abs: string; rel: string; depth: number }> = [
      { abs: startAbs, rel: startRel, depth: 0 },
    ];
    while (stack.length > 0) {
      if (signal.aborted) {
        return { exitCode: 0 };
      }
      const frame = stack.pop();
      if (!frame || frame.depth > MAX_DEPTH) {
        continue;
      }
      let dir;
      try {
        dir = await opendir(frame.abs);
      } catch {
        continue;
      }
      for await (const dirent of dir) {
        if (signal.aborted) {
          return { exitCode: 0 };
        }
        const name = dirent.name;
        if (name === "." || name === "..") {
          continue;
        }
        const childAbs = join(frame.abs, name);
        const childRel = frame.rel === "" ? name : `${frame.rel}/${name}`;
        const childRelPosix = posixRel(childRel);

        if (dirent.isSymbolicLink()) {
          // File symlinks are realpath-filtered; directory symlinks are never followed.
          let target;
          try {
            target = await stat(childAbs);
          } catch {
            continue;
          }
          if (target.isDirectory()) {
            continue;
          }
          if (target.isFile()) {
            await emitFileMatches(
              input.rootReal,
              childRelPosix,
              input,
              onMatch,
              signal,
            );
          }
          continue;
        }
        if (dirent.isDirectory()) {
          if (skipDir(name, childRelPosix, input)) {
            continue;
          }
          if (frame.depth < MAX_DEPTH) {
            stack.push({
              abs: childAbs,
              rel: childRelPosix,
              depth: frame.depth + 1,
            });
          }
          continue;
        }
        if (dirent.isFile()) {
          await emitFileMatches(
            input.rootReal,
            childRelPosix,
            input,
            onMatch,
            signal,
          );
        }
      }
    }
    return { exitCode: 0 };
  }
}
