import type { SearchRequest } from "@web-grep/shared";

export type RgMatch = {
  path: string;
  line: number;
  text: string;
  submatches: Array<{ start: number; end: number }>;
};

export type EngineSearchInput = {
  rootReal: string;
  relativeDir: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wordMatch: boolean;
  hidden: boolean;
  globInclude: string[];
  globExclude: string[];
  allowSecrets: boolean;
  followSymlinks: boolean;
  noIgnore: boolean;
  threads: number;
};

export type EngineResult = {
  exitCode: number | null;
};

export type SearchEngine = {
  readonly kind: "rg" | "literal";
  search(
    input: EngineSearchInput,
    onMatch: (match: RgMatch) => Promise<void>,
    signal: AbortSignal,
  ): Promise<EngineResult>;
};

export type SearchPreflightOk = {
  ok: true;
  searchId: string;
  request: SearchRequest;
  relativeDir: string;
  globInclude: string[];
  globExclude: string[];
  maxResults: number;
};

export type SearchPreflightErr = {
  ok: false;
  error: {
    code:
      | "INVALID_PATH"
      | "INVALID_GLOB"
      | "DENIED"
      | "BUSY"
      | "ENGINE"
      | "ENGINE_UNSUPPORTED";
    message: string;
  };
  status: 400 | 403 | 429 | 503;
};

export type SearchPreflight = SearchPreflightOk | SearchPreflightErr;
