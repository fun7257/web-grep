import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

export async function postSearch(
  app: Hono,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return apiRequest(app, "http://127.0.0.1:8787/api/search", {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function createSearchFixture(): Promise<{
  root: string;
  rootReal: string;
  outside: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "web-grep-search-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "web-grep-out-"));
  await writeFile(path.join(root, "ok.txt"), "hello-needle\n");
  await writeFile(
    path.join(root, "hits.txt"),
    "TRUNC\nTRUNC\nTRUNC\nTRUNC\nTRUNC\n",
  );
  await writeFile(path.join(root, "cjk.txt"), "hello 你 world\n");
  await writeFile(
    path.join(root, "flags.txt"),
    "the flag -n is here\nalso --json appears\n",
  );
  await writeFile(path.join(root, ".env"), "SECRET=1\nTRUNC\n");
  await writeFile(path.join(root, ".env.example"), "EXAMPLE_NEEDLE=1\n");
  await writeFile(
    path.join(root, "binary.bin"),
    Buffer.from("NULNEEDLE\0more"),
  );
  await mkdir(path.join(root, "sub"));
  await writeFile(path.join(root, "sub", "a.ts"), "hello-needle in sub\n");
  await writeFile(path.join(outside, "outside.txt"), "LINKOUTNEEDLE\nTRUNC\n");
  await symlink(path.join(outside, "outside.txt"), path.join(root, "link-out"));
  const rootReal = await realpath(root);
  return {
    root,
    rootReal,
    outside,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
}
