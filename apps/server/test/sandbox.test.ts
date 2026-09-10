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
import {
  PathSandboxError,
  resolveUnderRoot,
} from "../src/sandbox/resolvePath.ts";

describe("resolveUnderRoot", () => {
  let root = "";
  let rootReal = "";
  let outside = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "web-grep-sb-"));
    outside = await mkdtemp(path.join(os.tmpdir(), "web-grep-out-"));
    await writeFile(path.join(outside, "outside.txt"), "outside");
    await writeFile(path.join(root, "ok.txt"), "ok");
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "a.ts"), "a");
    await mkdir(path.join(root, "nested"));
    await symlink(
      path.join(outside, "outside.txt"),
      path.join(root, "link-out"),
    );
    await symlink("../ok.txt", path.join(root, "nested", "link-in"));
    await writeFile(path.join(root, "..%2F"), "literal");
    rootReal = await realpath(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("accepts the root as empty string and .", async () => {
    await expect(resolveUnderRoot(rootReal, "")).resolves.toEqual({
      abs: rootReal,
      rel: "",
    });
    await expect(resolveUnderRoot(rootReal, ".")).resolves.toEqual({
      abs: rootReal,
      rel: "",
    });
  });

  it("accepts a subdirectory and file", async () => {
    const sub = await resolveUnderRoot(rootReal, "sub");
    expect(sub.rel).toBe("sub");
    const file = await resolveUnderRoot(rootReal, "sub/a.ts");
    expect(file.rel).toBe("sub/a.ts");
  });

  it("accepts a symlink that stays inside the root", async () => {
    const result = await resolveUnderRoot(rootReal, "nested/link-in");
    expect(result.rel).toBe("ok.txt");
    expect(result.abs).toBe(path.join(rootReal, "ok.txt"));
  });

  it("treats ..%2F as a literal name, not traversal", async () => {
    const result = await resolveUnderRoot(rootReal, "..%2F");
    expect(result.rel).toBe("..%2F");
  });

  it("rejects ../ traversal", async () => {
    await expect(resolveUnderRoot(rootReal, "../")).rejects.toBeInstanceOf(
      PathSandboxError,
    );
  });

  it("rejects an absolute path", async () => {
    await expect(
      resolveUnderRoot(rootReal, "/etc/passwd"),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(resolveUnderRoot(rootReal, "/")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects sub/../../etc", async () => {
    await expect(
      resolveUnderRoot(rootReal, "sub/../../etc"),
    ).rejects.toBeInstanceOf(PathSandboxError);
  });

  it("rejects a symlink that escapes the root", async () => {
    await expect(resolveUnderRoot(rootReal, "link-out")).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects NUL in the path", async () => {
    await expect(
      resolveUnderRoot(rootReal, "ok.txt\0.jpg"),
    ).rejects.toBeInstanceOf(PathSandboxError);
  });

  it("rejects a missing prefix without remainder-join", async () => {
    await expect(
      resolveUnderRoot(rootReal, "does-not-exist"),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  });
});
