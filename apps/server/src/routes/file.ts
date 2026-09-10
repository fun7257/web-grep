import { type FileQuery, FileQuerySchema } from "@web-grep/shared";
import type { Hono } from "hono";
import * as z from "zod";
import type { Config } from "../config.ts";
import { jsonErrorValidator } from "../jsonErrorValidator.ts";
import { log } from "../log.ts";
import { PreviewError, readWindow } from "../preview/readWindow.ts";

function coerceQueryNumber(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function coerceFileQuery(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const q = value as Record<string, unknown>;
  const out: Record<string, unknown> = {
    path: q.path,
    line: coerceQueryNumber(q.line),
  };
  if (q.before !== undefined) {
    out.before = coerceQueryNumber(q.before);
  }
  if (q.after !== undefined) {
    out.after = coerceQueryNumber(q.after);
  }
  return out;
}

// Query values are strings; FileQuerySchema expects numbers.
const FileQueryFromQuerySchema = z.preprocess(coerceFileQuery, FileQuerySchema);

function parseFileQuery(value: unknown): FileQuery {
  return FileQuerySchema.parse(coerceFileQuery(value));
}

export function registerFileRoutes(app: Hono, config: Config): void {
  app.get(
    "/api/file",
    jsonErrorValidator("query", FileQueryFromQuerySchema),
    async (c) => {
      const query = parseFileQuery(c.req.query());
      try {
        const body = await readWindow({
          rootReal: config.rootReal,
          allowSecrets: config.allowSecrets,
          previewBytes: config.previewBytes,
          previewLines: config.previewLines,
          query,
        });
        return c.json(body);
      } catch (err) {
        if (err instanceof PreviewError) {
          log.warn("sandbox reject", { code: err.code });
          return c.json({ code: err.code, message: err.message }, err.status);
        }
        throw err;
      }
    },
  );
}
