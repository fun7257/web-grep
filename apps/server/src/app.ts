import { Hono } from "hono";
import { authMiddleware, hostOriginMiddleware } from "./auth.ts";
import type { Config, EngineKind } from "./config.ts";
import { registerFileRoutes } from "./routes/file.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerMetaRoutes } from "./routes/meta.ts";
import { registerSearchRoutes } from "./routes/search.ts";
import {
  createSearchService,
  type SearchService,
} from "./search/searchService.ts";
import { registerStaticRoutes } from "./static.ts";

export type AppDeps = {
  config: Config;
  engine: EngineKind;
  rgVersion?: string | null;
  search?: SearchService;
  rgBin?: string;
  webDist?: string;
};

export function createApp(deps: AppDeps): Hono {
  const search =
    deps.search ??
    createSearchService({
      config: deps.config,
      engine: deps.engine,
      ...(deps.rgBin !== undefined ? { rgBin: deps.rgBin } : {}),
    });
  const app = new Hono();
  app.use("/api/*", hostOriginMiddleware(deps.config));
  registerHealthRoutes(app, deps.engine);
  app.use("/api/*", authMiddleware(deps.config));
  registerMetaRoutes(app, deps.config, deps.engine, deps.rgVersion ?? null);
  registerSearchRoutes(app, search);
  registerFileRoutes(app, deps.config);
  if (deps.webDist !== undefined) {
    registerStaticRoutes(app, deps.webDist);
  }
  return app;
}
