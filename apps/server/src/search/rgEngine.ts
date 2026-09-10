import { type ChildProcess, spawn } from "node:child_process";
import readline from "node:readline";
import { parseRgMatchLine } from "./parseRgJson.ts";
import { defaultRgArgv, rgEnv, terminateChild } from "./spawnRg.ts";
import type {
  EngineResult,
  EngineSearchInput,
  RgMatch,
  SearchEngine,
} from "./types.ts";

function waitExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      resolve(code);
    };
    const onExit = (code: number | null): void => {
      finish(code);
    };
    const onError = (): void => {
      finish(2);
    };
    child.once("exit", onExit);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(child.exitCode);
    }
  });
}

export class RgEngine implements SearchEngine {
  readonly kind = "rg" as const;
  readonly rgBin: string;

  constructor(rgBin: string) {
    this.rgBin = rgBin;
  }

  async search(
    input: EngineSearchInput,
    onMatch: (match: RgMatch) => Promise<void>,
    signal: AbortSignal,
  ): Promise<EngineResult> {
    if (signal.aborted) {
      return { exitCode: 0 };
    }
    const argv = defaultRgArgv(input);
    const child = spawn(this.rgBin, argv, {
      cwd: input.rootReal,
      env: rgEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const exited = waitExit(child);

    const kill = (): void => {
      terminateChild(child);
    };
    if (signal.aborted) {
      kill();
      return { exitCode: await exited };
    }
    signal.addEventListener("abort", kill, { once: true });

    let failed = false;
    try {
      child.stderr?.resume();
      if (!child.stdout) {
        failed = true;
      } else {
        const rl = readline.createInterface({ input: child.stdout });
        try {
          for await (const line of rl) {
            if (signal.aborted) {
              break;
            }
            const match = parseRgMatchLine(line);
            if (!match) {
              continue;
            }
            await onMatch(match);
          }
        } finally {
          rl.close();
        }
      }
    } catch {
      failed = true;
    } finally {
      if (signal.aborted || failed) {
        kill();
      }
    }
    try {
      return { exitCode: await exited };
    } finally {
      signal.removeEventListener("abort", kill);
    }
  }
}
