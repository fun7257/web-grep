export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const REDACTED_KEYS = new Set(["token", "authorization", "x-web-grep-token"]);

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function write(
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  if (ORDER[level] < ORDER[minLevel]) {
    return;
  }
  const rec: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        continue;
      }
      rec[key] = value;
    }
  }
  console.log(JSON.stringify(rec));
}

export const log = {
  debug(msg: string, extra?: Record<string, unknown>): void {
    write("debug", msg, extra);
  },
  info(msg: string, extra?: Record<string, unknown>): void {
    write("info", msg, extra);
  },
  warn(msg: string, extra?: Record<string, unknown>): void {
    write("warn", msg, extra);
  },
  error(msg: string, extra?: Record<string, unknown>): void {
    write("error", msg, extra);
  },
};
