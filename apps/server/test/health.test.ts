import { describe, expect, it } from "vitest";
import { apiRequest, testApp } from "./helpers.ts";

describe("GET /api/health", () => {
  it('returns { ok: true, engine: "none" }', async () => {
    const app = testApp();
    const res = await apiRequest(app, "http://127.0.0.1:8787/api/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, engine: "none" });
  });
});
