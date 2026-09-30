import type { ShareState } from "./searchShare.ts";
import { toRgShareCommand } from "./searchStack.ts";

/**
 * The `rg` line that reproduces one hit outside the browser, or null when
 * there is no query or no absolute root to point at.
 */
export function buildRgShareCommand(opts: {
  state: ShareState;
  hit: { path: string; line: number };
  rootAbs: string | undefined;
  hidden: boolean;
}): string | null {
  const { state, hit, rootAbs, hidden } = opts;
  if (rootAbs === undefined || rootAbs === "") {
    return null;
  }
  const query = state.parts[0] ?? "";
  if (query === "") {
    return null;
  }
  const head = state.mods?.[0] ?? {
    caseSensitive: state.caseSensitive,
    wordMatch: state.wordMatch,
    regex: state.regex,
  };
  return toRgShareCommand({
    query,
    regex: head.regex,
    caseSensitive: head.caseSensitive,
    wordMatch: head.wordMatch,
    hidden,
    rootAbs,
    relPaths: [hit.path],
    filterTerms: state.parts.slice(1).map((term, index) => {
      const mod = state.mods?.[index + 1];
      return {
        query: term,
        regex: mod?.regex ?? false,
        caseSensitive: mod?.caseSensitive ?? false,
        wordMatch: mod?.wordMatch ?? false,
      };
    }),
    line: hit.line,
  });
}
