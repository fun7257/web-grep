import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { assertBindPolicy, loadConfig } from "./config.ts";
import { log, setLogLevel } from "./log.ts";
import { createSearchService } from "./search/searchService.ts";
import { detectRgBinary, probeRgVersion } from "./search/spawnRg.ts";

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

const rgBin = await detectRgBinary(config.rgPath);
const engine = rgBin !== undefined ? ("rg" as const) : ("none" as const);
const rgVersion = rgBin !== undefined ? await probeRgVersion(rgBin) : null;
const search = createSearchService({
  config,
  engine,
  ...(rgBin !== undefined ? { rgBin } : {}),
});
const app = createApp({ config, engine, rgVersion, search });

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
  search.abortAll();
  server.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
