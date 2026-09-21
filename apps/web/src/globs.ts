export function parseGlobs(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasGlobMeta(pat: string): boolean {
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === "\\" && i + 1 < pat.length) {
      i += 1;
      continue;
    }
    const ch = pat[i];
    if (ch === "*" || ch === "?" || ch === "[") {
      return true;
    }
  }
  return false;
}

function globToRegExp(pat: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pat.length) {
    if (pat[i] === "\\" && i + 1 < pat.length) {
      out += escapeRegex(pat[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (pat[i] === "*" && pat[i + 1] === "*") {
      if (pat[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
        continue;
      }
      out += ".*";
      i += 2;
      continue;
    }
    const ch = pat[i] ?? "";
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegex(ch);
    }
    i += 1;
  }
  return new RegExp(`${out}$`);
}

// Tree picks are literal paths. ripgrep globs treat these as syntax,
// so an unescaped `[id]` or `{id}` segment matches nothing.
const globMeta = /[\\*?[\]{}!]/g;

export function escapeGlobPath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.replace(globMeta, (ch) => `\\${ch}`))
    .join("/");
}

function userGlobRegExp(pattern: string): RegExp | null {
  let trimmed = pattern.trim();
  if (trimmed === "") {
    return null;
  }
  const anchored = trimmed.startsWith("/");
  if (anchored) {
    trimmed = trimmed.slice(1);
    if (trimmed === "") {
      return null;
    }
  }
  trimmed = trimmed.replace(/\/+$/, "");
  if (!anchored && !trimmed.includes("/") && hasGlobMeta(trimmed)) {
    trimmed = `**/${trimmed}`;
  }
  return globToRegExp(trimmed);
}

export function matchesUserGlob(path: string, pattern: string): boolean {
  const re = userGlobRegExp(pattern);
  return re !== null && re.test(path);
}

export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesUserGlob(path, pattern));
}
