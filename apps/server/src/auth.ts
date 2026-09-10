import { timingSafeEqual } from "node:crypto";
import type { JsonError } from "@web-grep/shared";
import type { MiddlewareHandler } from "hono";
import { type Config, normalizeHostname } from "./config.ts";
import { log } from "./log.ts";

const ALWAYS_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const VITE_DEV_PORT = "5173";

export function allowedHostnames(config: Config): Set<string> {
  const hosts = new Set(ALWAYS_HOSTS);
  for (const host of config.publicHosts) {
    const normalized = normalizeHostname(host);
    if (normalized === "0.0.0.0" || normalized === "::") {
      continue;
    }
    hosts.add(normalized);
  }
  return hosts;
}

export function splitHostPort(host: string): {
  hostname: string;
  port: string | null;
} {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) {
      return { hostname: normalizeHostname(trimmed), port: null };
    }
    const hostname = normalizeHostname(trimmed.slice(0, end + 1));
    const rest = trimmed.slice(end + 1);
    const port = rest.startsWith(":") && rest.length > 1 ? rest.slice(1) : null;
    return { hostname, port };
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) {
    return { hostname: normalizeHostname(trimmed), port: null };
  }
  const portPart = trimmed.slice(lastColon + 1);
  const onlyOneColon = trimmed.indexOf(":") === lastColon;
  if (onlyOneColon && portPart.length > 0 && /^[0-9]+$/.test(portPart)) {
    return {
      hostname: normalizeHostname(trimmed.slice(0, lastColon)),
      port: portPart,
    };
  }
  return { hostname: normalizeHostname(trimmed), port: null };
}

function isAllowedListenOrDevPort(port: string, config: Config): boolean {
  if (port === String(config.port)) {
    return true;
  }
  return config.isDevelopment && port === VITE_DEV_PORT;
}

export function isAllowedHostHeader(
  hostHeader: string,
  config: Config,
  hosts: Set<string> = allowedHostnames(config),
): boolean {
  const { hostname, port } = splitHostPort(hostHeader);
  if (hostname === "0.0.0.0" || hostname === "::" || !hosts.has(hostname)) {
    return false;
  }
  if (port === null) {
    return !ALWAYS_HOSTS.has(hostname);
  }
  return isAllowedListenOrDevPort(port, config);
}

export function isAllowedOrigin(
  origin: string,
  config: Config,
  hosts: Set<string> = allowedHostnames(config),
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const hostname = normalizeHostname(url.hostname);
  if (hostname === "0.0.0.0" || hostname === "::" || !hosts.has(hostname)) {
    return false;
  }
  const port =
    url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  if (port === "80" || port === "443") {
    return true;
  }
  return isAllowedListenOrDevPort(port, config);
}

function jsonError(code: JsonError["code"], message: string): JsonError {
  return { code, message };
}

function extractToken(
  authorization: string | undefined,
  xToken: string | undefined,
): string | undefined {
  if (xToken !== undefined && xToken !== "") {
    return xToken;
  }
  if (authorization === undefined || authorization === "") {
    return undefined;
  }
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
  return match?.[1];
}

function tokenEquals(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.byteLength !== b.byteLength) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hostOriginMiddleware(config: Config): MiddlewareHandler {
  const hosts = allowedHostnames(config);
  return async (c, next) => {
    const hostHeader = c.req.header("host");
    if (!hostHeader || !isAllowedHostHeader(hostHeader, config, hosts)) {
      log.warn("bad Host", { code: "FORBIDDEN_HOST", host: hostHeader ?? "" });
      return c.json(jsonError("FORBIDDEN_HOST", "Host not allowed"), 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== "") {
      if (!isAllowedOrigin(origin, config, hosts)) {
        log.warn("bad Origin", { code: "FORBIDDEN_HOST" });
        return c.json(jsonError("FORBIDDEN_HOST", "Host not allowed"), 403);
      }
    }
    await next();
  };
}

export function authMiddleware(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/api/health") {
      return next();
    }
    const expected = config.token;
    if (expected === undefined) {
      return next();
    }
    const provided = extractToken(
      c.req.header("authorization"),
      c.req.header("x-web-grep-token"),
    );
    if (provided === undefined || !tokenEquals(expected, provided)) {
      log.warn("auth fail", { code: "UNAUTHORIZED" });
      return c.json(jsonError("UNAUTHORIZED", "missing or invalid token"), 401);
    }
    await next();
  };
}
