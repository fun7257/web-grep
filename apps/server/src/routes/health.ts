import type { Hono } from "hono";
import type { EngineKind } from "../config.ts";

export function registerHealthRoutes(app: Hono, engine: EngineKind): void {
  app.get("/api/health", (c) => c.json({ ok: true, engine }));
}
