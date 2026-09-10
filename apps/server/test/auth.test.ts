import { LIMITS, MetaResponseSchema } from "@web-grep/shared";
import { describe, expect, it } from "vitest";
import { apiRequest, testApp } from "./helpers.ts";

describe("auth and Host/Origin", () => {
  it("returns 401 when a token is configured and missing", async () => {
    const app = testApp({ token: "s3cret" });
    const res = await apiRequest(app, "http://127.0.0.1:8787/api/meta");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "missing or invalid token",
    });
  });

  it("accepts Authorization Bearer and X-Web-Grep-Token", async () => {
    const app = testApp({ token: "s3cret" });
    const bearer = await apiRequest(app, "http://127.0.0.1:8787/api/meta", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(bearer.status).toBe(200);
    const header = await apiRequest(app, "http://127.0.0.1:8787/api/meta", {
      headers: { "X-Web-Grep-Token": "s3cret" },
    });
    expect(header.status).toBe(200);
  });

  it("returns 403 FORBIDDEN_HOST for Host 0.0.0.0:8787", async () => {
    const app = testApp();
    const res = await apiRequest(app, "http://0.0.0.0:8787/api/health");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      code: "FORBIDDEN_HOST",
      message: "Host not allowed",
    });
  });

  it("does not treat X-Forwarded-Host as an allowed name", async () => {
    const app = testApp();
    const res = await apiRequest(app, "http://0.0.0.0:8787/api/health", {
      headers: { "X-Forwarded-Host": "127.0.0.1:8787" },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
  });

  it("allows a LAN Host only when it is in PUBLIC_HOST", async () => {
    const denied = testApp();
    const deniedRes = await apiRequest(
      denied,
      "http://192.168.1.10:8787/api/health",
    );
    expect(deniedRes.status).toBe(403);
    await expect(deniedRes.json()).resolves.toMatchObject({
      code: "FORBIDDEN_HOST",
    });

    const allowed = testApp({ publicHosts: ["192.168.1.10"] });
    const allowedRes = await apiRequest(
      allowed,
      "http://192.168.1.10:8787/api/health",
    );
    expect(allowedRes.status).toBe(200);
  });

  it("keeps health public when a token is configured", async () => {
    const app = testApp({ token: "s3cret" });
    const res = await apiRequest(app, "http://127.0.0.1:8787/api/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, engine: "none" });
  });

  it("still applies the Host check to health", async () => {
    const app = testApp({ token: "s3cret" });
    const res = await apiRequest(app, "http://evil.example:8787/api/health");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "FORBIDDEN_HOST",
    });
  });

  it("allows Vite Origin :5173 only in development", async () => {
    const prod = testApp();
    const prodRes = await apiRequest(prod, "http://127.0.0.1:8787/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(prodRes.status).toBe(403);

    const dev = testApp({ isDevelopment: true });
    const devRes = await apiRequest(dev, "http://127.0.0.1:8787/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(devRes.status).toBe(200);

    const httpsPublic = testApp({ publicHosts: ["grep.lab"] });
    const httpsRes = await apiRequest(
      httpsPublic,
      "http://grep.lab/api/health",
      {
        headers: { Origin: "https://grep.lab" },
      },
    );
    expect(httpsRes.status).toBe(200);
  });

  it("returns meta behind auth in the shared schema shape", async () => {
    const app = testApp({
      token: "s3cret",
      rootLabel: "repo",
      followSymlinks: true,
    });
    const res = await apiRequest(app, "http://127.0.0.1:8787/api/meta", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    const body = MetaResponseSchema.parse(await res.json());
    expect(body).toEqual({
      engine: "none",
      rgVersion: null,
      rootLabel: "repo",
      followSymlinks: true,
      limits: {
        maxResults: LIMITS.maxResultsDefault,
        maxResultsHard: LIMITS.maxResultsHard,
        timeoutMs: LIMITS.timeoutMsDefault,
        previewBytes: LIMITS.previewBytes,
        previewLines: LIMITS.previewLines,
        queryMaxChars: LIMITS.queryMaxChars,
      },
      defaultLocale: "zh-CN",
      authRequired: true,
    });
  });
});
