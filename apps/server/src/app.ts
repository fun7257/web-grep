import { Hono } from "hono";
import { registerHealthRoutes } from "./routes/health.ts";

export function createApp(): Hono {
  const app = new Hono();
  registerHealthRoutes(app);
  return app;
}
