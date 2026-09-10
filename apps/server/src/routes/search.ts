import { SearchRequestSchema } from "@web-grep/shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SearchService } from "../search/searchService.ts";
import { jsonErrorValidator } from "../validate.ts";

export function registerSearchRoutes(app: Hono, search: SearchService): void {
  app.post(
    "/api/search",
    jsonErrorValidator("json", SearchRequestSchema),
    async (c) => {
      const req = c.req.valid("json");
      const pre = await search.preflight(req);
      if (!pre.ok) {
        return c.json(pre.error, pre.status);
      }
      const res = streamSSE(c, async (stream) => {
        const onAbort = (): void => {
          search.cancel(pre.searchId);
        };
        stream.onAbort(onAbort);
        await search.run(pre, stream, c.req.raw.signal);
      });
      res.headers.set("Cache-Control", "no-cache, no-transform");
      res.headers.set("X-Accel-Buffering", "no");
      return res;
    },
  );
}
