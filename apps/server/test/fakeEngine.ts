import { lstat, opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  EngineResult,
  EngineSearchInput,
  RgMatch,
  SearchEngine,
} from "../src/search/types.ts";

const encoder = new TextEncoder();

function globMatches(glob: string, relPosix: string): boolean {
  const base = relPosix.split("/").pop() ?? relPosix;
  if (glob === relPosix || glob === base) {
    return true;
  }
  if (glob.startsWith("*.")) {
    const suffix = glob.slice(1);
    return relPosix.endsWith(suffix) || base.endsWith(suffix);
  }
  return false;
}

function globAllowed(
  relPosix: string,
  include: string[],
  exclude: string[],
): boolean {
  if (exclude.some((g) => globMatches(g, relPosix))) {
    return false;
  }
  if (include.length === 0) {
    return true;
  }
  return include.some((g) => globMatches(g, relPosix));
}

function byteRange(
  line: string,
  start: number,
  end: number,
): {
  start: number;
  end: number;
} {
  return {
    start: encoder.encode(line.slice(0, start)).byteLength,
    end: encoder.encode(line.slice(0, end)).byteLength,
  };
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

function submatchesFor(
  line: string,
  input: EngineSearchInput,
): Array<{ start: number; end: number }> {
  if (!input.regex) {
    const hay = input.caseSensitive ? line : line.toLocaleLowerCase("en");
    const needle = input.caseSensitive
      ? input.query
      : input.query.toLocaleLowerCase("en");
    const idx = hay.indexOf(needle);
    if (idx === -1) {
      return [];
    }
    const end = idx + needle.length;
    if (input.wordMatch && !isWordBoundary(line, idx, end)) {
      return [];
    }
    return [byteRange(line, idx, end)];
  }
  const source = input.wordMatch ? `\\b(?:${input.query})\\b` : input.query;
  let re: RegExp;
  try {
    re = new RegExp(source, input.caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }
  const m = re.exec(line);
  if (!m || m[0] === "" || m.index === undefined) {
    return [];
  }
  return [byteRange(line, m.index, m.index + m[0].length)];
}

async function collectFiles(
  rootReal: string,
  relativeDir: string,
  followSymlinks: boolean,
): Promise<Array<{ rel: string; abs: string }>> {
  const startAbs =
    relativeDir === "." ? rootReal : path.join(rootReal, relativeDir);
  const startRel =
    relativeDir === "." ? "" : relativeDir.split(path.sep).join("/");
  const out: Array<{ rel: string; abs: string }> = [];
  const stack: Array<{ abs: string; rel: string; depth: number }> = [];

  let startStat;
  try {
    startStat = await lstat(startAbs);
  } catch {
    return out;
  }

  const pushFile = (abs: string, rel: string): void => {
    out.push({ abs, rel: rel === "" ? path.basename(abs) : rel });
  };

  if (startStat.isSymbolicLink() || startStat.isFile()) {
    try {
      const followed = await stat(startAbs);
      if (!followed.isDirectory()) {
        pushFile(startAbs, startRel);
        return out;
      }
      if (!followSymlinks && startStat.isSymbolicLink()) {
        return out;
      }
    } catch {
      return out;
    }
  }

  stack.push({ abs: startAbs, rel: startRel, depth: 0 });
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame || frame.depth > 32) {
      continue;
    }
    let dir;
    try {
      dir = await opendir(frame.abs);
    } catch {
      continue;
    }
    for await (const dirent of dir) {
      const childAbs = path.join(frame.abs, dirent.name);
      const childRel =
        frame.rel === "" ? dirent.name : `${frame.rel}/${dirent.name}`;
      if (dirent.isSymbolicLink()) {
        try {
          const followed = await stat(childAbs);
          if (followed.isDirectory()) {
            if (followSymlinks) {
              stack.push({
                abs: childAbs,
                rel: childRel,
                depth: frame.depth + 1,
              });
            }
            continue;
          }
          pushFile(childAbs, childRel);
        } catch {
          continue;
        }
      } else if (dirent.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel, depth: frame.depth + 1 });
      } else if (dirent.isFile()) {
        pushFile(childAbs, childRel);
      }
    }
  }
  return out;
}

export function createFakeEngine(
  opts: { hold?: Promise<void> } = {},
): SearchEngine {
  return {
    kind: "rg",
    async search(
      input: EngineSearchInput,
      onMatch: (match: RgMatch) => Promise<void>,
      signal: AbortSignal,
    ): Promise<EngineResult> {
      if (opts.hold !== undefined) {
        await Promise.race([
          opts.hold,
          new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      }
      if (signal.aborted) {
        return { exitCode: 0 };
      }
      const files = await collectFiles(
        input.rootReal,
        input.relativeDir,
        input.followSymlinks,
      );
      for (const file of files) {
        if (signal.aborted) {
          return { exitCode: 0 };
        }
        const relPosix = file.rel.split("\\").join("/");
        if (!globAllowed(relPosix, input.globInclude, input.globExclude)) {
          continue;
        }
        let buf: Buffer;
        try {
          buf = await readFile(file.abs);
        } catch {
          continue;
        }
        if (buf.includes(0)) {
          continue;
        }
        const content = buf.toString("utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (signal.aborted) {
            return { exitCode: 0 };
          }
          const raw = lines[i];
          if (raw === undefined) {
            continue;
          }
          const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          const submatches = submatchesFor(line, input);
          if (submatches.length === 0) {
            continue;
          }
          await onMatch({
            path: relPosix,
            line: i + 1,
            text: `${line}\n`,
            submatches,
          });
        }
      }
      return { exitCode: 0 };
    },
  };
}
