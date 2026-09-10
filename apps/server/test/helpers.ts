import { LIMITS } from "@web-grep/shared";
import type { Hono } from "hono";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    rootReal: "/tmp",
    rootLabel: "tmp",
    host: "127.0.0.1",
    port: 8787,
    publicHosts: [],
    token: undefined,
    allowSecrets: false,
    followSymlinks: false,
    noIgnore: false,
    maxResults: LIMITS.maxResultsDefault,
    maxResultsHard: LIMITS.maxResultsHard,
    timeoutMs: LIMITS.timeoutMsDefault,
    previewBytes: LIMITS.previewBytes,
    previewLines: LIMITS.previewLines,
    threads: 0,
    rgPath: undefined,
    logLevel: "info",
    isDevelopment: false,
    ...overrides,
  };
}

export function testApp(overrides: Partial<Config> = {}) {
  return createApp({ engine: "none", config: testConfig(overrides) });
}

/** Fetch Request does not populate Host from the URL; tests must set it. */
export async function apiRequest(
  app: Hono,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) {
    headers.set("host", new URL(url, "http://127.0.0.1:8787").host);
  }
  return await app.request(url, { ...init, headers });
}
