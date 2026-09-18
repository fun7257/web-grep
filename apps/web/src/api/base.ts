export const PUBLIC_PATH_META = "web-grep-base";
export const PUBLIC_PATH_MARKER = "__WEB_GREP_BASE__";

export function normalizePublicPath(raw: string): string {
  let path = raw.trim();
  if (path === "" || path === "/" || path === PUBLIC_PATH_MARKER) {
    return "";
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path.replace(/\/+$/, "");
}

export function readPublicPath(): string {
  if (typeof document === "undefined") {
    return "";
  }
  const content = document
    .querySelector(`meta[name="${PUBLIC_PATH_META}"]`)
    ?.getAttribute("content");
  if (content === null || content === undefined) {
    return "";
  }
  return normalizePublicPath(content);
}

export function apiUrl(path: string): string {
  const prefix = readPublicPath();
  const rest = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${rest}`;
}
