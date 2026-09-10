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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { LiteralEngine } from "../src/search/literalFallback.ts";
import type { EngineSearchInput, RgMatch } from "../src/search/types.ts";
import { apiRequest, postSearch, testConfig } from "./helpers.ts";

function input(rootReal: string): EngineSearchInput {
  return {
    rootReal,
    relativeDir: ".",
    query: "NEEDLE",
    regex: false,
    caseSensitive: true,
    wordMatch: false,
    hidden: false,
    globInclude: [],
    globExclude: [],
    allowSecrets: false,
    followSymlinks: false,
    noIgnore: false,
    threads: 0,
  };
}

async function collect(
  engine: LiteralEngine,
  searchInput: EngineSearchInput,
): Promise<RgMatch[]> {
  const hits: RgMatch[] = [];
  await engine.search(
    searchInput,
    async (match) => {
      hits.push(match);
    },
    new AbortController().signal,
  );
  return hits;
}

describe("LiteralEngine walker", () => {
  let root = "";
  let rootReal = "";
  let outside = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "web-grep-lit-"));
    outside = await mkdtemp(path.join(os.tmpdir(), "web-grep-lit-out-"));
    await writeFile(path.join(root, "ok.txt"), "hello NEEDLE world\n");
    await writeFile(path.join(root, ".env"), "SECRET=NEEDLE\n");
    await writeFile(path.join(root, "credentials.json"), "DENYNEEDLE\n");
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "ignored.txt"), "gitignored NEEDLE\n");
    await writeFile(path.join(root, "regex.txt"), "aaa\nliteral a+ here\n");
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".git", "HEAD"), "gitdir NEEDLE\n");
    await writeFile(path.join(outside, "outside.txt"), "LINKOUT NEEDLE\n");
    await symlink(
      path.join(outside, "outside.txt"),
      path.join(root, "link-out"),
    );
    await mkdir(path.join(outside, "extdir"));
    await writeFile(path.join(outside, "extdir", "x.txt"), "DIRLINK NEEDLE\n");
    await symlink(path.join(outside, "extdir"), path.join(root, "link-dir"));
    rootReal = await realpath(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("finds a literal needle under the root", async () => {
    const hits = await collect(new LiteralEngine(), input(rootReal));
    expect(hits.some((h) => h.path === "ok.txt")).toBe(true);
  });

  it("skips denylisted files", async () => {
    const hits = await collect(new LiteralEngine(), {
      ...input(rootReal),
      query: "DENYNEEDLE",
      hidden: true,
    });
    expect(hits).toHaveLength(0);
  });

  it("skips file and directory symlink escapes", async () => {
    const fileHits = await collect(new LiteralEngine(), {
      ...input(rootReal),
      query: "LINKOUT",
    });
    expect(fileHits).toHaveLength(0);
    const dirHits = await collect(new LiteralEngine(), {
      ...input(rootReal),
      query: "DIRLINK",
    });
    expect(dirHits).toHaveLength(0);
  });

  it("does not honor gitignore", async () => {
    const hits = await collect(new LiteralEngine(), input(rootReal));
    expect(hits.some((h) => h.path === "ignored.txt")).toBe(true);
  });

  it("does not interpret the query as regex", async () => {
    const hits = await collect(new LiteralEngine(), {
      ...input(rootReal),
      query: "a+",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("regex.txt");
    expect(hits[0]?.line).toBe(2);
  });

  it("returns no matches when regex is true (preflight is the HTTP gate)", async () => {
    const hits = await collect(new LiteralEngine(), {
      ...input(rootReal),
      regex: true,
    });
    expect(hits).toHaveLength(0);
  });
});

describe("POST /api/search literal engine", () => {
  let fixtureRoot = "";
  let rootReal = "";

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "web-grep-lit-http-"));
    await writeFile(path.join(fixtureRoot, "ok.txt"), "hello-needle\n");
    rootReal = await realpath(fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  function app() {
    const config = testConfig({
      rootReal,
      rootLabel: path.basename(rootReal),
    });
    return createApp({ config, engine: "literal" });
  }

  it("returns HTTP 400 ENGINE_UNSUPPORTED for regex before SSE", async () => {
    const res = await postSearch(app(), { query: "hello-needle", regex: true });
    expect(res.status).toBe(400);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("json");
    expect(ct).not.toContain("event-stream");
    await expect(res.json()).resolves.toMatchObject({
      code: "ENGINE_UNSUPPORTED",
    });
  });

  it("GET /api/meta reports engine literal", async () => {
    const res = await apiRequest(app(), "http://127.0.0.1:8787/api/meta");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ engine: "literal" });
  });
});
