import * as nodePath from "node:path";
import picomatch from "picomatch";

const PM = { dot: true, nocase: false } as const;

export const DENY_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "id_rsa",
  "id_rsa.*",
  "id_dsa",
  "id_ed25519",
  "*.pypirc",
  ".npmrc",
  "credentials.json",
  "**/secrets.yaml",
  "**/secrets.yml",
  "**/*secret*",
  "**/*credential*",
  ".git/**",
] as const;

const denyMatchers = DENY_GLOBS.map((g) => picomatch(g, PM));
const envExampleMatcher = picomatch(".env.example", PM);

export class GlobError extends Error {
  readonly code = "INVALID_GLOB" as const;
  constructor(message = "invalid glob") {
    super(message);
    this.name = "GlobError";
  }
}

export function isDenied(relPosix: string, allowSecrets: boolean): boolean {
  if (allowSecrets) {
    return false;
  }
  const base = relPosix.split("/").pop() ?? relPosix;
  if (envExampleMatcher(base)) {
    return false;
  }
  return denyMatchers.some((match) => match(relPosix) || match(base));
}

export function denylistRgGlobs(allowSecrets: boolean): string[] {
  if (allowSecrets) {
    return [];
  }
  return [...DENY_GLOBS.map((g) => `!${g}`), ".env.example"];
}

export function sanitizeUserGlob(glob: string): string {
  if (glob.includes("\0") || glob.includes("\n") || glob.includes("\r")) {
    throw new GlobError("glob contains invalid characters");
  }
  const trimmed = glob.trim();
  if (trimmed === "") {
    throw new GlobError("empty glob");
  }
  if (trimmed.startsWith("!")) {
    throw new GlobError("negated globs are not allowed");
  }
  if (trimmed.includes("--")) {
    throw new GlobError("glob contains --");
  }
  if (nodePath.isAbsolute(trimmed) || nodePath.win32.isAbsolute(trimmed)) {
    throw new GlobError("absolute glob");
  }
  const segments = trimmed.split(/[\\/]/);
  if (segments.some((segment) => segment === "..")) {
    throw new GlobError("glob contains ..");
  }
  return trimmed;
}

export function assertGlobIncludeAllowed(
  glob: string,
  allowSecrets: boolean,
): string {
  const clean = sanitizeUserGlob(glob);
  const posix = clean.split("\\").join("/");
  if (isDenied(posix, allowSecrets)) {
    throw new GlobError("glob is denied");
  }
  return clean;
}
