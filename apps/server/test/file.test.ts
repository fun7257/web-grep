import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileWindowResponseSchema } from "@web-grep/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiRequest, testApp } from "./helpers.ts";

describe("GET /api/file", () => {
  let root = "";
  let rootReal = "";
  let outside = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "web-grep-file-"));
    outside = await mkdtemp(path.join(os.tmpdir(), "web-grep-file-out-"));
    await writeFile(path.join(outside, "outside.txt"), "outside secret\n");
    await writeFile(path.join(root, ".env"), "SECRET=1\n");
    await writeFile(
      path.join(root, "cjk.txt"),
      [
        "零",
        "一",
        "二",
        "三",
        "四",
        "目标行：你好世界",
        "六",
        "七",
        "八",
        "九",
      ].join("\n") + "\n",
    );
    await writeFile(
      path.join(root, "small.bin"),
      Buffer.from([0x68, 0x69, 0x00, 0x7a]),
    );
    await symlink(
      path.join(outside, "outside.txt"),
      path.join(root, "link-out"),
    );
    rootReal = await realpath(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  function app() {
    return testApp({ rootReal });
  }

  it("returns 403 DENIED for .env", async () => {
    const res = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/file?path=.env&line=1",
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      code: "DENIED",
      message: "path is denied",
    });
  });

  it("returns a CJK window around a known line", async () => {
    const url = new URL("http://127.0.0.1:8787/api/file");
    url.searchParams.set("path", "cjk.txt");
    url.searchParams.set("line", "6");
    url.searchParams.set("before", "2");
    url.searchParams.set("after", "2");
    const res = await apiRequest(app(), url.toString());
    expect(res.status).toBe(200);
    const body = FileWindowResponseSchema.parse(await res.json());
    expect(body).toEqual({
      path: "cjk.txt",
      startLine: 4,
      lineCount: 5,
      truncated: true,
      binary: false,
      lines: [
        { n: 4, text: "三" },
        { n: 5, text: "四" },
        { n: 6, text: "目标行：你好世界" },
        { n: 7, text: "六" },
        { n: 8, text: "七" },
      ],
    });
  });

  it("sniffs a small binary as binary with no lines", async () => {
    const res = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/file?path=small.bin&line=1",
    );
    expect(res.status).toBe(200);
    const body = FileWindowResponseSchema.parse(await res.json());
    expect(body).toEqual({
      path: "small.bin",
      startLine: 1,
      lineCount: 0,
      truncated: false,
      binary: true,
      lines: [],
    });
  });

  it("returns 404 INVALID_PATH for a missing path", async () => {
    const res = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/file?path=does-not-exist&line=1",
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects a symlink that escapes the root", async () => {
    const res = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/file?path=link-out&line=1",
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("returns 400 INVALID_QUERY for an empty query", async () => {
    const res = await apiRequest(app(), "http://127.0.0.1:8787/api/file");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "INVALID_QUERY" });
    expect(body).not.toHaveProperty("success");
    expect(typeof (body as { message: unknown }).message).toBe("string");
  });

  it("returns 400 INVALID_QUERY for a non-numeric line", async () => {
    const res = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/file?path=cjk.txt&line=abc",
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "INVALID_QUERY",
    });
  });
});
