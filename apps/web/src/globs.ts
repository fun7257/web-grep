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
  return /[*?\[]/.test(pat);
}

function globToRegExp(pat: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pat.length) {
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
