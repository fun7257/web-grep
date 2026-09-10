import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { denylistRgGlobs } from "../src/sandbox/denylist.ts";
import type { RgArgvInput } from "../src/search/spawnRg.ts";
import {
  buildRgArgv,
  detectBundledRg,
  detectRgBinary,
  resolveRgBinary,
  rgEnv,
} from "../src/search/spawnRg.ts";

function baseArgv(overrides: Partial<RgArgvInput> = {}): string[] {
  return buildRgArgv({
    rootReal: "/tmp/root",
    relativeDir: ".",
    query: "needle",
    regex: true,
    caseSensitive: true,
    wordMatch: false,
    hidden: false,
    globInclude: [],
    globExclude: [],
    allowSecrets: false,
    followSymlinks: false,
    noIgnore: false,
    threads: 0,
    maxCount: 100,
    maxColumns: 2048,
    maxFilesize: "8M",
    ...overrides,
  });
}

function globValues(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--glob") {
      const value = argv[i + 1];
      if (value !== undefined) {
        out.push(value);
      }
    }
  }
  return out;
}

describe("buildRgArgv", () => {
  it("uses --no-config, one --, and never --binary", () => {
    const argv = baseArgv({ query: "-n" });
    expect(argv[0]).toBe("--no-config");
    expect(argv).not.toContain("--binary");
    expect(argv.filter((a) => a === "--")).toHaveLength(1);
    const dash = argv.indexOf("--");
    expect(argv[dash + 1]).toBe("-n");
    expect(argv[dash + 2]).toBe(".");
    expect(argv[dash + 3]).toBeUndefined();
  });

  it("treats --json as the pattern after --", () => {
    const argv = baseArgv({ query: "--json" });
    const dash = argv.indexOf("--");
    expect(argv[dash + 1]).toBe("--json");
    expect(argv[dash + 2]).toBe(".");
  });

  it("appends denylist globs last and skips a trailing *", () => {
    const argv = baseArgv({ globInclude: ["*.ts"] });
    const globs = globValues(argv);
    const deny = denylistRgGlobs(false, true);
    expect(globs.slice(-deny.length)).toEqual(deny);
    expect(globs.at(-1)).toBe(".env.example");
    expect(globs).not.toContain("*");
    expect(argv.indexOf("--")).toBeGreaterThan(argv.lastIndexOf("--glob"));
  });

  it("does not emit a positive .env.example glob without user includes", () => {
    const globs = globValues(baseArgv());
    expect(globs).not.toContain(".env.example");
    expect(globs.every((g) => g.startsWith("!"))).toBe(true);
  });

  it("rejects an absolute relativeDir", () => {
    expect(() => baseArgv({ relativeDir: "/etc" })).toThrow(/relativeDir/);
  });
});

describe("rgEnv", () => {
  it("allowlists PATH/LANG/LC_ALL and omits HOME and RIPGREP_CONFIG_PATH", () => {
    const env = rgEnv();
    expect(env).not.toHaveProperty("HOME");
    expect(env).not.toHaveProperty("RIPGREP_CONFIG_PATH");
    expect(env).not.toHaveProperty("TERM");
    if (process.env.PATH !== undefined) {
      expect(env.PATH).toBe(process.env.PATH);
    }
    expect(env.LANG).toBe(process.env.LANG ?? "C.UTF-8");
    expect(env.LC_ALL).toBe(process.env.LC_ALL ?? "C.UTF-8");
  });
});

describe("detectRgBinary", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("walks PATH for an executable rg without using which", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-rg-"));
    dirs.push(dir);
    const bin = path.join(dir, "rg");
    await writeFile(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await expect(detectRgBinary(undefined, dir)).resolves.toBe(bin);
    await expect(detectRgBinary(undefined, "")).resolves.toBeUndefined();
  });

  it("prefers an absolute WEB_GREP_RG override that is executable", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-rg-"));
    dirs.push(dir);
    const override = path.join(dir, "custom-rg");
    await writeFile(override, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await expect(detectRgBinary(override, "")).resolves.toBe(override);
  });

  it("ignores a relative override and empty PATH", async () => {
    await expect(detectRgBinary("rg", "")).resolves.toBeUndefined();
  });

  it("skips a PATH directory named rg", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-rg-"));
    dirs.push(dir);
    await mkdir(path.join(dir, "rg"));
    await expect(detectRgBinary(undefined, dir)).resolves.toBeUndefined();
  });

  it("resolveRgBinary falls back to @vscode/ripgrep when PATH is empty", async () => {
    const bundled = await detectBundledRg();
    await expect(resolveRgBinary(undefined, "")).resolves.toBe(bundled);
    await expect(detectRgBinary(undefined, "")).resolves.toBeUndefined();
  });
});
