import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { LIMITS } from "@web-grep/shared";
import { denylistRgGlobs } from "../sandbox/denylist.ts";
import type { EngineSearchInput } from "./types.ts";

const RG_NAMES =
  process.platform === "win32"
    ? (["rg.exe", "rg"] as const)
    : (["rg"] as const);

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const st = await stat(candidate);
    if (!st.isFile()) {
      return false;
    }
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectRgBinary(
  override: string | undefined,
  pathEnv: string | undefined = process.env.PATH,
): Promise<string | undefined> {
  if (override !== undefined && isAbsolute(override)) {
    if (await isExecutableFile(override)) {
      return override;
    }
  }
  for (const dir of (pathEnv ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    for (const name of RG_NAMES) {
      const candidate = join(dir, name);
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function rgEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  };
  if (process.env.PATH !== undefined) {
    env.PATH = process.env.PATH;
  }
  return env;
}

export type RgArgvInput = EngineSearchInput & {
  maxCount: number;
  maxColumns: number;
  maxFilesize: string;
};

export function buildRgArgv(input: RgArgvInput): string[] {
  if (isAbsolute(input.relativeDir)) {
    throw new Error("relativeDir must not be absolute");
  }
  const argv: string[] = [
    "--no-config",
    "--json",
    "--line-number",
    "--with-filename",
    "--no-heading",
    "--glob",
    "!.git/**",
    "--max-columns",
    String(input.maxColumns),
    "--max-columns-preview",
    "--max-filesize",
    input.maxFilesize,
    "--threads",
    String(input.threads),
    "--max-count",
    String(input.maxCount),
  ];
  if (!input.regex) {
    argv.push("-F");
  }
  argv.push(input.caseSensitive ? "-s" : "-i");
  if (input.wordMatch) {
    argv.push("-w");
  }
  if (input.hidden) {
    argv.push("--hidden");
  }
  if (input.followSymlinks) {
    argv.push("--follow");
  }
  if (input.noIgnore) {
    argv.push("--no-ignore-vcs");
  }
  for (const glob of input.globInclude) {
    argv.push("--glob", glob);
  }
  for (const glob of input.globExclude) {
    argv.push("--glob", `!${glob}`);
  }
  const deny = denylistRgGlobs(
    input.allowSecrets,
    input.globInclude.length > 0,
  );
  for (const glob of deny) {
    argv.push("--glob", glob);
  }
  argv.push("--", input.query, input.relativeDir);
  return argv;
}

export function defaultRgArgv(input: EngineSearchInput): string[] {
  return buildRgArgv({
    ...input,
    maxCount: LIMITS.perFileMaxCount,
    maxColumns: LIMITS.lineTextMaxChars,
    maxFilesize: LIMITS.maxFilesizeRg,
  });
}

export function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }, 1000);
  timer.unref();
  child.once("exit", () => {
    clearTimeout(timer);
  });
}

export function probeRgVersion(rgBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(rgBin, ["--no-config", "--version"], {
      env: rgEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      terminateChild(child);
      resolve(null);
    }, 2000);
    timer.unref();
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      const first = out.split(/\r?\n/)[0]?.trim();
      resolve(first ? first : null);
    });
  });
}
