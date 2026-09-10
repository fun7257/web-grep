import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RgEngine } from "../src/search/rgEngine.ts";
import type { EngineSearchInput } from "../src/search/types.ts";

function input(rootReal: string): EngineSearchInput {
  return {
    rootReal,
    relativeDir: ".",
    query: "needle",
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

describe("RgEngine process lifecycle", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("maps spawn failure to a non-zero exit instead of hanging", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-rgeng-"));
    dirs.push(dir);
    const engine = new RgEngine(path.join(dir, "missing-rg"));
    const result = await engine.search(
      input(dir),
      async () => {},
      new AbortController().signal,
    );
    expect(result.exitCode).toBe(2);
  });

  it("waits for a successful scan to exit 0 without SIGTERM", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-rgeng-"));
    dirs.push(dir);
    const bin = path.join(dir, "rg");
    const line = JSON.stringify({
      type: "match",
      data: {
        path: { text: "ok.txt" },
        lines: { text: "needle\n" },
        line_number: 1,
        absolute_offset: 0,
        submatches: [],
      },
    });
    await writeFile(
      bin,
      `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(`${line}\n`)});
process.exit(0);
`,
      { mode: 0o755 },
    );
    const engine = new RgEngine(bin);
    const paths: string[] = [];
    const result = await engine.search(
      input(dir),
      async (match) => {
        paths.push(match.path);
      },
      new AbortController().signal,
    );
    expect(paths).toEqual(["ok.txt"]);
    expect(result.exitCode).toBe(0);
  });
});
