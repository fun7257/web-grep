import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { LIMITS } from "@web-grep/shared";
import * as z from "zod";
import type { LogLevel } from "./log.ts";

export type EngineKind = "rg" | "literal" | "none";

const LOOPBACK_BIND = new Set(["127.0.0.1", "::1", "localhost"]);
const FORBIDDEN_PUBLIC_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

const EnvSchema = z.object({
  WEB_GREP_ROOT: z.string().trim().min(1, "WEB_GREP_ROOT is required"),
  WEB_GREP_HOST: z.string().optional(),
  WEB_GREP_PORT: z.string().optional(),
  WEB_GREP_PUBLIC_HOST: z.string().optional(),
  WEB_GREP_TOKEN: z.string().optional(),
  WEB_GREP_RG: z.string().optional(),
  WEB_GREP_MAX_RESULTS: z.string().optional(),
  WEB_GREP_MAX_RESULTS_HARD: z.string().optional(),
  WEB_GREP_TIMEOUT_MS: z.string().optional(),
  WEB_GREP_PREVIEW_BYTES: z.string().optional(),
  WEB_GREP_PREVIEW_LINES: z.string().optional(),
  WEB_GREP_THREADS: z.string().optional(),
  WEB_GREP_FOLLOW_SYMLINKS: z.string().optional(),
  WEB_GREP_NO_IGNORE: z.string().optional(),
  WEB_GREP_ALLOW_SECRETS: z.string().optional(),
  WEB_GREP_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  NODE_ENV: z.string().optional(),
});

export type Config = {
  rootReal: string;
  rootLabel: string;
  host: string;
  port: number;
  publicHosts: string[];
  token: string | undefined;
  allowSecrets: boolean;
  followSymlinks: boolean;
  noIgnore: boolean;
  maxResults: number;
  maxResultsHard: number;
  timeoutMs: number;
  previewBytes: number;
  previewLines: number;
  threads: number;
  rgPath: string | undefined;
  logLevel: LogLevel;
  isDevelopment: boolean;
};

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_BIND.has(host);
}

export function parsePublicHosts(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const hosts: string[] = [];
  for (const part of raw.split(",")) {
    const host = normalizeHostname(part);
    if (host === "") {
      continue;
    }
    if (FORBIDDEN_PUBLIC_HOSTS.has(host)) {
      throw new Error(
        "WEB_GREP_PUBLIC_HOST must not include 0.0.0.0 (bind address, not a Host)",
      );
    }
    hosts.push(host);
  }
  return hosts;
}

export function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function assertBindPolicy(config: Config): void {
  if (isLoopbackBind(config.host)) {
    return;
  }
  if (!config.token) {
    throw new Error(`Refusing to bind ${config.host} without WEB_GREP_TOKEN`);
  }
  if (config.publicHosts.length === 0) {
    throw new Error(
      "0.0.0.0 is a bind address, not a Host. Set WEB_GREP_PUBLIC_HOST to the name/IP in the address bar",
    );
  }
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const v = raw.toLowerCase();
  if (v === "1" || v === "true") {
    return true;
  }
  if (v === "0" || v === "false") {
    return false;
  }
  throw new Error(`invalid boolean value: ${raw}`);
}

function parseIntEnv(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${name}: ${raw}`);
  }
  return n;
}

function optionalNonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function resolveRoot(raw: string): Promise<string> {
  const resolved = resolve(raw);
  let st;
  try {
    st = await stat(resolved);
  } catch {
    throw new Error(`WEB_GREP_ROOT is not a readable directory: ${raw}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`WEB_GREP_ROOT is not a readable directory: ${raw}`);
  }
  try {
    await access(resolved, constants.R_OK);
  } catch {
    throw new Error(`WEB_GREP_ROOT is not a readable directory: ${raw}`);
  }
  return realpath(resolved);
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  if (env.WEB_GREP_ROOT === undefined || env.WEB_GREP_ROOT.trim() === "") {
    throw new Error("WEB_GREP_ROOT is required");
  }
  const parsed = EnvSchema.safeParse({
    WEB_GREP_ROOT: env.WEB_GREP_ROOT,
    WEB_GREP_HOST: env.WEB_GREP_HOST,
    WEB_GREP_PORT: env.WEB_GREP_PORT,
    WEB_GREP_PUBLIC_HOST: env.WEB_GREP_PUBLIC_HOST,
    WEB_GREP_TOKEN: env.WEB_GREP_TOKEN,
    WEB_GREP_RG: env.WEB_GREP_RG,
    WEB_GREP_MAX_RESULTS: env.WEB_GREP_MAX_RESULTS,
    WEB_GREP_MAX_RESULTS_HARD: env.WEB_GREP_MAX_RESULTS_HARD,
    WEB_GREP_TIMEOUT_MS: env.WEB_GREP_TIMEOUT_MS,
    WEB_GREP_PREVIEW_BYTES: env.WEB_GREP_PREVIEW_BYTES,
    WEB_GREP_PREVIEW_LINES: env.WEB_GREP_PREVIEW_LINES,
    WEB_GREP_THREADS: env.WEB_GREP_THREADS,
    WEB_GREP_FOLLOW_SYMLINKS: env.WEB_GREP_FOLLOW_SYMLINKS,
    WEB_GREP_NO_IGNORE: env.WEB_GREP_NO_IGNORE,
    WEB_GREP_ALLOW_SECRETS: env.WEB_GREP_ALLOW_SECRETS,
    WEB_GREP_LOG_LEVEL: env.WEB_GREP_LOG_LEVEL,
    NODE_ENV: env.NODE_ENV,
  });
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "invalid environment configuration";
    throw new Error(message);
  }
  const envValues = parsed.data;
  const rootReal = await resolveRoot(envValues.WEB_GREP_ROOT);
  const host = optionalNonEmpty(envValues.WEB_GREP_HOST) ?? "127.0.0.1";
  const maxResultsHard = parseIntEnv(
    envValues.WEB_GREP_MAX_RESULTS_HARD,
    LIMITS.maxResultsHard,
    1,
    LIMITS.maxResultsHard,
    "WEB_GREP_MAX_RESULTS_HARD",
  );
  const maxResults = Math.min(
    parseIntEnv(
      envValues.WEB_GREP_MAX_RESULTS,
      LIMITS.maxResultsDefault,
      1,
      maxResultsHard,
      "WEB_GREP_MAX_RESULTS",
    ),
    maxResultsHard,
  );
  const rgPath = optionalNonEmpty(envValues.WEB_GREP_RG);
  if (rgPath !== undefined && !isAbsolute(rgPath)) {
    throw new Error("WEB_GREP_RG must be an absolute path");
  }
  return {
    rootReal,
    rootLabel: basename(rootReal),
    host,
    port: parseIntEnv(envValues.WEB_GREP_PORT, 8787, 1, 65535, "WEB_GREP_PORT"),
    publicHosts: parsePublicHosts(envValues.WEB_GREP_PUBLIC_HOST),
    token: optionalNonEmpty(envValues.WEB_GREP_TOKEN),
    allowSecrets: parseBool(envValues.WEB_GREP_ALLOW_SECRETS, false),
    followSymlinks: parseBool(envValues.WEB_GREP_FOLLOW_SYMLINKS, false),
    noIgnore: parseBool(envValues.WEB_GREP_NO_IGNORE, false),
    maxResults,
    maxResultsHard,
    timeoutMs: parseIntEnv(
      envValues.WEB_GREP_TIMEOUT_MS,
      LIMITS.timeoutMsDefault,
      1,
      3_600_000,
      "WEB_GREP_TIMEOUT_MS",
    ),
    previewBytes: parseIntEnv(
      envValues.WEB_GREP_PREVIEW_BYTES,
      LIMITS.previewBytes,
      1,
      64 * 1024 * 1024,
      "WEB_GREP_PREVIEW_BYTES",
    ),
    previewLines: parseIntEnv(
      envValues.WEB_GREP_PREVIEW_LINES,
      LIMITS.previewLines,
      1,
      10_000,
      "WEB_GREP_PREVIEW_LINES",
    ),
    threads: parseIntEnv(
      envValues.WEB_GREP_THREADS,
      0,
      0,
      1024,
      "WEB_GREP_THREADS",
    ),
    rgPath,
    logLevel: envValues.WEB_GREP_LOG_LEVEL ?? "info",
    isDevelopment: envValues.NODE_ENV === "development",
  };
}
