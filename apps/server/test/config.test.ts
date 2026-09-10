import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertBindPolicy, loadConfig } from "../src/config.ts";
import { testConfig } from "./helpers.ts";

describe("loadConfig", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("fails without WEB_GREP_ROOT", async () => {
    await expect(loadConfig({})).rejects.toThrow(/WEB_GREP_ROOT/);
  });

  it("fails when WEB_GREP_ROOT is a file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-cfg-"));
    dirs.push(dir);
    const file = path.join(dir, "not-a-dir");
    await writeFile(file, "x");
    await expect(loadConfig({ WEB_GREP_ROOT: file })).rejects.toThrow(
      /WEB_GREP_ROOT/,
    );
  });

  it("realpaths an existing readable directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "web-grep-cfg-"));
    dirs.push(dir);
    await mkdir(path.join(dir, "nested"));
    const cfg = await loadConfig({ WEB_GREP_ROOT: dir });
    expect(cfg.rootLabel).toBe(path.basename(cfg.rootReal));
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8787);
    expect(cfg.allowSecrets).toBe(false);
    expect(cfg.token).toBeUndefined();
  });
});

describe("assertBindPolicy", () => {
  it("refuses a non-loopback bind without a token", () => {
    expect(() =>
      assertBindPolicy(
        testConfig({
          host: "0.0.0.0",
          token: undefined,
          publicHosts: ["192.168.1.10"],
        }),
      ),
    ).toThrow(/WEB_GREP_TOKEN/);
  });

  it("refuses a non-loopback bind without PUBLIC_HOST", () => {
    expect(() =>
      assertBindPolicy(
        testConfig({ host: "0.0.0.0", token: "t", publicHosts: [] }),
      ),
    ).toThrow(/WEB_GREP_PUBLIC_HOST/);
  });

  it("allows loopback without a token", () => {
    expect(() =>
      assertBindPolicy(testConfig({ host: "127.0.0.1", token: undefined })),
    ).not.toThrow();
    expect(() =>
      assertBindPolicy(testConfig({ host: "localhost", token: undefined })),
    ).not.toThrow();
    expect(() =>
      assertBindPolicy(testConfig({ host: "::1", token: undefined })),
    ).not.toThrow();
  });

  it("allows a non-loopback bind with token and PUBLIC_HOST", () => {
    expect(() =>
      assertBindPolicy(
        testConfig({
          host: "0.0.0.0",
          token: "t",
          publicHosts: ["192.168.1.10"],
        }),
      ),
    ).not.toThrow();
  });
});
