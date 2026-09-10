import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { assertBindPolicy, loadConfig } from "./config.ts";
import { log, setLogLevel } from "./log.ts";

const config = await loadConfig();
assertBindPolicy(config);
setLogLevel(config.logLevel);

if (!config.token) {
  log.warn(
    "WEB_GREP_TOKEN is unset; auth is disabled (Host/Origin still apply)",
  );
}
if (config.allowSecrets) {
  log.warn("WEB_GREP_ALLOW_SECRETS=true; denylist disabled");
}

const engine = "none" as const;
const app = createApp({ config, engine });

log.info("listening", {
  host: config.host,
  port: config.port,
  engine,
  rootLabel: config.rootLabel,
});
log.debug("root path", { root: config.rootReal });

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

const shutdown = (): void => {
  server.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
