export type FileKind = "markdown" | "json" | "code" | "text";

const CODE_EXT = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "py",
  "rb",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "cs",
  "swift",
  "css",
  "scss",
  "less",
  "yml",
  "yaml",
  "toml",
  "xml",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "proto",
  "html",
  "htm",
  "csv",
  "tsv",
]);

export function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

export function detectKind(path: string): FileKind {
  const ext = extOf(path);
  if (ext === "md" || ext === "mdx" || ext === "markdown") {
    return "markdown";
  }
  if (ext === "json" || ext === "jsonc") {
    return "json";
  }
  if (CODE_EXT.has(ext)) {
    return "code";
  }
  return "text";
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const start = trimmed[0];
  const end = trimmed[trimmed.length - 1];
  if (!((start === "{" && end === "}") || (start === "[" && end === "]"))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function detectLineKind(path: string, text: string): FileKind {
  if (looksLikeJson(text)) {
    return "json";
  }
  return detectKind(path);
}

export function kindLabel(kind: FileKind, path: string): string {
  if (kind === "json") {
    return "JSON";
  }
  if (kind === "markdown") {
    return "Markdown";
  }
  const ext = extOf(path);
  if (ext !== "") {
    return ext.toUpperCase();
  }
  return kind === "code" ? "Code" : "Text";
}

export function canFormat(kind: FileKind): boolean {
  return kind === "json" || kind === "markdown";
}
