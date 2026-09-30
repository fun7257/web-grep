import { describe, expect, it } from "vitest";
import type { ShareState } from "../searchShare.ts";
import { buildRgShareCommand } from "../shareCommand.ts";

const flags = { caseSensitive: false, wordMatch: false, regex: false };

function state(overrides: Partial<ShareState> = {}): ShareState {
  return { parts: ["hello"], mods: [flags], ...flags, ...overrides };
}

describe("buildRgShareCommand", () => {
  it("builds an rg line for the selected hit", () => {
    expect(
      buildRgShareCommand({
        state: state(),
        hit: { path: "src/a.ts", line: 12 },
        rootAbs: "/tmp/project",
        hidden: true,
      }),
    ).toBe(
      "rg -n -F -i --hidden -- hello /tmp/project/src/a.ts | rg '^12:' -r ''",
    );
  });

  it("pipes the extra filters with their own modifiers", () => {
    expect(
      buildRgShareCommand({
        state: state({
          parts: ["Hello", "world.*"],
          mods: [
            { caseSensitive: true, wordMatch: false, regex: false },
            { caseSensitive: false, wordMatch: false, regex: true },
          ],
        }),
        hit: { path: "a.log", line: 3 },
        rootAbs: "/r",
        hidden: false,
      }),
    ).toBe(
      "rg -n -F -s -- Hello /r/a.log | rg -i -- 'world.*' | rg '^3:' -r ''",
    );
  });

  it("falls back to the top-level flags when there are no per-row mods", () => {
    const { mods: _mods, ...rest } = state({ caseSensitive: true });
    expect(
      buildRgShareCommand({
        state: rest,
        hit: { path: "a.ts", line: 1 },
        rootAbs: "/r",
        hidden: false,
      }),
    ).toBe("rg -n -F -s -- hello /r/a.ts | rg '^1:' -r ''");
  });

  it("returns null without an absolute root or without a query", () => {
    const hit = { path: "a.ts", line: 1 };
    expect(
      buildRgShareCommand({
        state: state(),
        hit,
        rootAbs: undefined,
        hidden: true,
      }),
    ).toBeNull();
    expect(
      buildRgShareCommand({ state: state(), hit, rootAbs: "", hidden: true }),
    ).toBeNull();
    expect(
      buildRgShareCommand({
        state: state({ parts: [""] }),
        hit,
        rootAbs: "/r",
        hidden: true,
      }),
    ).toBeNull();
  });
});
