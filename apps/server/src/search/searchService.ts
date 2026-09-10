import { LIMITS, type SearchRequest, type SseDone } from "@web-grep/shared";
import type { SSEStreamingApi } from "hono/streaming";
import type { Config, EngineKind } from "../config.ts";
import { log } from "../log.ts";
import { GlobError, isDenied, sanitizeUserGlob } from "../sandbox/denylist.ts";
import { PathSandboxError, resolveUnderRoot } from "../sandbox/resolvePath.ts";
import { LiteralEngine } from "./literalFallback.ts";
import { RgEngine } from "./rgEngine.ts";
import { toRelativeHit } from "./toRelativeHit.ts";
import type {
  SearchEngine,
  SearchPreflight,
  SearchPreflightOk,
} from "./types.ts";

const MAX_CONCURRENT = 2;

type InFlight = {
  abort: AbortController;
};

export type SearchService = {
  readonly inflightCount: number;
  preflight(request: SearchRequest): Promise<SearchPreflight>;
  run(
    pre: SearchPreflightOk,
    stream: SSEStreamingApi,
    clientSignal: AbortSignal,
  ): Promise<void>;
  cancel(searchId: string): void;
  abortAll(): void;
};

function truncateQuery(query: string): string {
  return query.length > 80 ? query.slice(0, 80) : query;
}

async function writeEvent(
  stream: SSEStreamingApi,
  event: string,
  data: unknown,
): Promise<boolean> {
  if (stream.aborted || stream.closed) {
    return false;
  }
  await stream.writeSSE({ event, data: JSON.stringify(data) });
  return !stream.aborted && !stream.closed;
}

export function createSearchService(opts: {
  config: Config;
  engine: EngineKind;
  rgBin?: string;
  searchEngine?: SearchEngine;
}): SearchService {
  const inflight = new Map<string, InFlight>();
  const searchEngine =
    opts.searchEngine ??
    (opts.engine === "rg" && opts.rgBin !== undefined
      ? new RgEngine(opts.rgBin)
      : opts.engine === "literal"
        ? new LiteralEngine()
        : undefined);

  const cancel = (searchId: string): void => {
    inflight.get(searchId)?.abort.abort();
  };

  return {
    get inflightCount() {
      return inflight.size;
    },

    async preflight(request): Promise<SearchPreflight> {
      if (opts.engine === "none" || searchEngine === undefined) {
        return {
          ok: false,
          error: { code: "ENGINE", message: "ripgrep is not available" },
          status: 503,
        };
      }
      if (opts.engine === "literal" && request.regex) {
        return {
          ok: false,
          error: {
            code: "ENGINE_UNSUPPORTED",
            message: "regex is not supported without ripgrep",
          },
          status: 400,
        };
      }

      let resolved: { abs: string; rel: string };
      try {
        resolved = await resolveUnderRoot(opts.config.rootReal, request.path);
      } catch (err) {
        if (err instanceof PathSandboxError) {
          log.warn("sandbox reject", { code: "INVALID_PATH" });
          return {
            ok: false,
            error: { code: "INVALID_PATH", message: err.message },
            status: 400,
          };
        }
        throw err;
      }
      if (
        resolved.rel !== "" &&
        isDenied(resolved.rel, opts.config.allowSecrets)
      ) {
        return {
          ok: false,
          error: { code: "DENIED", message: "path is denied" },
          status: 403,
        };
      }

      const globInclude: string[] = [];
      const globExclude: string[] = [];
      try {
        for (const glob of request.globInclude) {
          const clean = sanitizeUserGlob(glob);
          const posix = clean.split("\\").join("/");
          if (isDenied(posix, opts.config.allowSecrets)) {
            continue;
          }
          globInclude.push(clean);
        }
        for (const glob of request.globExclude) {
          globExclude.push(sanitizeUserGlob(glob));
        }
      } catch (err) {
        if (err instanceof GlobError) {
          return {
            ok: false,
            error: { code: "INVALID_GLOB", message: err.message },
            status: 400,
          };
        }
        throw err;
      }

      if (inflight.size >= MAX_CONCURRENT) {
        return {
          ok: false,
          error: { code: "BUSY", message: "too many concurrent searches" },
          status: 429,
        };
      }

      const searchId = crypto.randomUUID();
      inflight.set(searchId, { abort: new AbortController() });
      const maxResults = Math.min(
        request.maxResults ?? opts.config.maxResults,
        opts.config.maxResultsHard,
      );
      return {
        ok: true,
        searchId,
        request,
        relativeDir: resolved.rel === "" ? "." : resolved.rel,
        globInclude,
        globExclude,
        maxResults,
      };
    },

    async run(pre, stream, clientSignal): Promise<void> {
      const rec = inflight.get(pre.searchId);
      const started = Date.now();
      let truncated = false;
      let matchCount = 0;
      const files = new Set<string>();
      let terminalSent = false;

      const timeoutAbort = new AbortController();
      const timeoutTimer = setTimeout(() => {
        timeoutAbort.abort();
      }, opts.config.timeoutMs);
      timeoutTimer.unref();

      const stop = new AbortController();
      const signals = [timeoutAbort.signal, stop.signal];
      if (rec) {
        signals.push(rec.abort.signal);
      }
      signals.push(clientSignal);
      const combined = AbortSignal.any(signals);

      const sendDone = async (flags: {
        truncated: boolean;
        timedOut: boolean;
        cancelled: boolean;
      }): Promise<void> => {
        if (terminalSent) {
          return;
        }
        terminalSent = true;
        const data: SseDone = {
          elapsedMs: Date.now() - started,
          matchCount,
          fileCount: files.size,
          truncated: flags.truncated,
          timedOut: flags.timedOut,
          cancelled: flags.cancelled,
        };
        await writeEvent(stream, "done", data);
      };

      const sendError = async (message: string): Promise<void> => {
        if (terminalSent) {
          return;
        }
        terminalSent = true;
        await writeEvent(stream, "error", {
          code: "ENGINE" as const,
          message,
        });
      };

      const heartbeat = setInterval(() => {
        void stream.write(": ping\n\n");
      }, LIMITS.heartbeatMs);
      heartbeat.unref();

      try {
        log.debug("search start", {
          searchId: pre.searchId,
          query: truncateQuery(pre.request.query),
        });
        const metaOk = await writeEvent(stream, "meta", {
          searchId: pre.searchId,
          engine: searchEngine?.kind ?? "rg",
        });
        if (!metaOk) {
          return;
        }

        if (searchEngine === undefined) {
          await sendError(
            opts.engine === "literal"
              ? "search failed"
              : "ripgrep is not available",
          );
          return;
        }

        // Denied includes are dropped; if none remain, do not widen to the tree.
        if (
          pre.request.globInclude.length > 0 &&
          pre.globInclude.length === 0
        ) {
          await sendDone({
            truncated: false,
            timedOut: false,
            cancelled: false,
          });
          log.info("search done", {
            searchId: pre.searchId,
            elapsedMs: Date.now() - started,
            matchCount,
          });
          return;
        }

        const result = await searchEngine.search(
          {
            rootReal: opts.config.rootReal,
            relativeDir: pre.relativeDir,
            query: pre.request.query,
            regex: pre.request.regex,
            caseSensitive: pre.request.caseSensitive,
            wordMatch: pre.request.wordMatch,
            hidden: pre.request.hidden,
            globInclude: pre.globInclude,
            globExclude: pre.globExclude,
            allowSecrets: opts.config.allowSecrets,
            followSymlinks: opts.config.followSymlinks,
            noIgnore: opts.config.noIgnore,
            threads: opts.config.threads,
          },
          async (match) => {
            if (truncated || combined.aborted) {
              return;
            }
            const hit = await toRelativeHit(
              opts.config.rootReal,
              opts.config.allowSecrets,
              match,
            );
            if (!hit) {
              return;
            }
            if (
              truncated ||
              combined.aborted ||
              stream.aborted ||
              stream.closed
            ) {
              return;
            }
            await stream.writeSSE({
              event: "hit",
              data: JSON.stringify(hit),
            });
            if (stream.aborted || stream.closed) {
              return;
            }
            matchCount += 1;
            files.add(hit.path);
            if (matchCount >= pre.maxResults) {
              truncated = true;
              stop.abort();
            }
          },
          combined,
        );

        const timedOut = timeoutAbort.signal.aborted;
        const cancelled =
          clientSignal.aborted || (rec?.abort.signal.aborted ?? false);

        if (truncated) {
          await sendDone({
            truncated: true,
            timedOut: false,
            cancelled: false,
          });
          log.info("search done", {
            searchId: pre.searchId,
            elapsedMs: Date.now() - started,
            matchCount,
          });
          return;
        }
        if (timedOut) {
          log.warn("search timeout", { searchId: pre.searchId });
          await sendDone({
            truncated: false,
            timedOut: true,
            cancelled: false,
          });
          return;
        }
        if (cancelled) {
          log.warn("search abort", { searchId: pre.searchId });
          await sendDone({
            truncated: false,
            timedOut: false,
            cancelled: true,
          });
          return;
        }
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          log.error("rg crash", {
            searchId: pre.searchId,
            code: "ENGINE",
          });
          await sendError(
            searchEngine.kind === "literal"
              ? "search failed"
              : "ripgrep failed",
          );
          return;
        }
        await sendDone({
          truncated: false,
          timedOut: false,
          cancelled: false,
        });
        log.info("search done", {
          searchId: pre.searchId,
          elapsedMs: Date.now() - started,
          matchCount,
        });
      } catch (err) {
        log.error("search failed", {
          searchId: pre.searchId,
          code: "ENGINE",
          err: err instanceof Error ? err.message : String(err),
        });
        await sendError(
          searchEngine?.kind === "literal" ? "search failed" : "ripgrep failed",
        );
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timeoutTimer);
        inflight.delete(pre.searchId);
      }
    },

    cancel,
    abortAll(): void {
      for (const rec of inflight.values()) {
        rec.abort.abort();
      }
    },
  };
}
