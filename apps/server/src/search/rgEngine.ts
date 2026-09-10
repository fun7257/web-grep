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
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    child.once("exit", (code) => {
      resolve(code);
    });
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

    const kill = (): void => {
      terminateChild(child);
    };
    if (signal.aborted) {
      kill();
      return { exitCode: await waitExit(child) };
    }
    signal.addEventListener("abort", kill, { once: true });

    try {
      child.stderr?.resume();
      if (!child.stdout) {
        kill();
        return { exitCode: 2 };
      }
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
    } catch {
      kill();
    } finally {
      signal.removeEventListener("abort", kill);
      kill();
    }
    return { exitCode: await waitExit(child) };
  }
}
