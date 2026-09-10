import { Hono } from "hono";
import { authMiddleware, hostOriginMiddleware } from "./auth.ts";
import type { Config, EngineKind } from "./config.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerMetaRoutes } from "./routes/meta.ts";

export type AppDeps = {
  config: Config;
  engine: EngineKind;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("/api/*", hostOriginMiddleware(deps.config));
  registerHealthRoutes(app, deps.engine);
  app.use("/api/*", authMiddleware(deps.config));
  registerMetaRoutes(app, deps.config, deps.engine);
  return app;
}
