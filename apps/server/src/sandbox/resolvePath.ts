import { lstat, realpath } from "node:fs/promises";
import * as nodePath from "node:path";

export type PathModule = {
  isAbsolute: (p: string) => boolean;
  resolve: (...pathSegments: string[]) => string;
  relative: (from: string, to: string) => string;
  sep: string;
};

export class PathSandboxError extends Error {
  readonly code = "INVALID_PATH" as const;
  constructor(message = "invalid path") {
    super(message);
    this.name = "PathSandboxError";
  }
}

function escapesRoot(rel: string, sep: string): boolean {
  // Segment-aware: "..%2F" is a literal filename, not traversal.
  return rel === ".." || rel.startsWith(`..${sep}`);
}

export function toPosixRel(rel: string): string {
  return rel.split("\\").join("/");
}

export function joinUnderRoot(
  rootReal: string,
  userRel: string,
  p: PathModule = nodePath,
): string {
  if (userRel.includes("\0")) {
    throw new PathSandboxError("path contains NUL");
  }
  const trimmed = userRel.trim();
  const input = trimmed === "" || trimmed === "." ? "" : trimmed;
  if (input !== "" && p.isAbsolute(input)) {
    throw new PathSandboxError("absolute path");
  }
  const joined = input === "" ? rootReal : p.resolve(rootReal, input);
  const rel = p.relative(rootReal, joined);
  if (rel !== "" && (escapesRoot(rel, p.sep) || p.isAbsolute(rel))) {
    throw new PathSandboxError("path escapes root");
  }
  return joined;
}

export async function resolveUnderRoot(
  rootReal: string,
  userRel: string,
  p: PathModule = nodePath,
): Promise<{ abs: string; rel: string }> {
  const joined = joinUnderRoot(rootReal, userRel, p);
  try {
    await lstat(joined);
  } catch {
    throw new PathSandboxError("path does not exist");
  }
  let abs: string;
  try {
    abs = await realpath(joined);
  } catch {
    throw new PathSandboxError("path does not exist");
  }
  const relReal = p.relative(rootReal, abs);
  if (
    relReal !== "" &&
    (escapesRoot(relReal, p.sep) || p.isAbsolute(relReal))
  ) {
    throw new PathSandboxError("path escapes root");
  }
  return { abs, rel: toPosixRel(relReal) };
}
