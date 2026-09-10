import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function resolveWebDist(from: string = import.meta.url): string {
  return resolve(dirname(fileURLToPath(from)), "../../web/dist");
}

export function registerStaticRoutes(app: Hono, webDist: string): void {
  // Unmatched /api/* must not fall through to the SPA.
  app.all("/api/*", (c) =>
    c.json({ code: "INTERNAL" as const, message: "not found" }, 404),
  );
  app.get("/*", serveStatic({ root: webDist }));
  const indexPath = join(webDist, "index.html");
  if (existsSync(indexPath)) {
    app.get("/*", serveStatic({ root: webDist, path: "index.html" }));
  }
}
