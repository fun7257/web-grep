import { LIMITS, type MetaResponse } from "@web-grep/shared";
import type { Hono } from "hono";
import type { Config, EngineKind } from "../config.ts";

export function metaPayload(
  config: Config,
  engine: EngineKind,
  rgVersion: string | null = null,
): MetaResponse {
  return {
    engine,
    rgVersion,
    rootLabel: config.rootLabel,
    followSymlinks: config.followSymlinks,
    limits: {
      maxResults: config.maxResults,
      maxResultsHard: config.maxResultsHard,
      timeoutMs: config.timeoutMs,
      previewBytes: config.previewBytes,
      previewLines: config.previewLines,
      queryMaxChars: LIMITS.queryMaxChars,
    },
    defaultLocale: "zh-CN",
    authRequired: Boolean(config.token),
  };
}

export function registerMetaRoutes(
  app: Hono,
  config: Config,
  engine: EngineKind,
  rgVersion: string | null = null,
): void {
  app.get("/api/meta", (c) => c.json(metaPayload(config, engine, rgVersion)));
}
