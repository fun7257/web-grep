import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { apiRequest, postSearch, testConfig } from "./helpers.ts";

describe("prod static serve", () => {
  let webDist = "";

  beforeEach(async () => {
    webDist = await mkdtemp(path.join(os.tmpdir(), "web-grep-dist-"));
    await writeFile(
      path.join(webDist, "index.html"),
      "<!doctype html><title>spa</title>",
    );
    await writeFile(path.join(webDist, "asset.txt"), "asset-ok");
    await mkdir(path.join(webDist, "api"));
    await writeFile(path.join(webDist, "api", "health"), "swallowed");
  });

  afterEach(async () => {
    await rm(webDist, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      engine: "none",
      config: testConfig(),
      webDist,
    });
  }

  it("serves the SPA and static assets", async () => {
    const index = await apiRequest(app(), "http://127.0.0.1:8787/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("<title>spa</title>");

    const asset = await apiRequest(app(), "http://127.0.0.1:8787/asset.txt");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("asset-ok");

    const spa = await apiRequest(
      app(),
      "http://127.0.0.1:8787/some/client/route",
    );
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("<title>spa</title>");
  });

  it("does not swallow /api/* routes", async () => {
    const health = await apiRequest(app(), "http://127.0.0.1:8787/api/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      ok: true,
      engine: "none",
    });
    expect(health.headers.get("content-type") ?? "").toContain("json");

    const missing = await apiRequest(
      app(),
      "http://127.0.0.1:8787/api/does-not-exist",
    );
    expect(missing.status).toBe(404);
    const missingText = await missing.text();
    expect(JSON.parse(missingText)).toMatchObject({ code: "INTERNAL" });
    expect(missingText).not.toContain("<title>spa</title>");

    const search = await postSearch(app(), { query: "hello-needle" });
    expect(search.status).toBe(503);
    await expect(search.json()).resolves.toMatchObject({ code: "ENGINE" });
    expect(search.headers.get("content-type") ?? "").toContain("json");
    expect(search.headers.get("content-type") ?? "").not.toContain(
      "event-stream",
    );
  });
});
