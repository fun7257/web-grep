import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const HOST = "127.0.0.1";
const PORT = 8787;

serve({
  fetch: createApp().fetch,
  hostname: HOST,
  port: PORT,
});
