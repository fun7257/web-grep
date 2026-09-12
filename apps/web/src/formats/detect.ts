export type FileKind =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "code"
  | "text";

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
  if (ext === "csv" || ext === "tsv") {
    return "csv";
  }
  if (ext === "html" || ext === "htm") {
    return "html";
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
  if (
    !((start === "{" && end === "}") || (start === "[" && end === "]"))
  ) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim();
  return /^<\/?[a-zA-Z][\s\S]*>/.test(trimmed);
}

export function detectLineKind(path: string, text: string): FileKind {
  if (looksLikeJson(text)) {
    return "json";
  }
  const fromPath = detectKind(path);
  if (fromPath === "html" || looksLikeHtml(text)) {
    return "html";
  }
  if (fromPath === "markdown" || fromPath === "csv") {
    return fromPath;
  }
  return fromPath;
}

export function kindLabel(kind: FileKind, path: string): string {
  if (kind === "json") {
    return "JSON";
  }
  if (kind === "markdown") {
    return "Markdown";
  }
  if (kind === "csv") {
    return "CSV";
  }
  if (kind === "html") {
    return "HTML";
  }
  const ext = extOf(path);
  if (ext !== "") {
    return ext.toUpperCase();
  }
  return kind === "code" ? "Code" : "Text";
}

export function canFormat(kind: FileKind): boolean {
  return kind === "json" || kind === "markdown" || kind === "csv" || kind === "html";
}
