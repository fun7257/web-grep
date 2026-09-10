import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("GET /api/health", () => {
  it('returns { ok: true, engine: "none" }', async () => {
    const app = createApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, engine: "none" });
  });
});
