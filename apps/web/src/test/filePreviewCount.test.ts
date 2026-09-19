/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFileWindow } from "../api/fileClient.ts";
import { loadMetaResponse } from "../api/metaClient.ts";
import { setLivePreviewLimits } from "../previewChunk.ts";

const META = {
  engine: "rg",
  rgVersion: "14.1.0",
  rootLabel: "project",
  root: "/tmp/project",
  followSymlinks: false,
  limits: {
    maxResults: 10_000,
    maxResultsHard: 50_000,
    timeoutMs: 30_000,
    previewBytes: 1_048_576,
    previewLines: 201,
    previewChunk: 80,
    previewChunkMax: 400,
    queryMaxChars: 512,
  },
  defaultLocale: "zh-CN",
  authRequired: false,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("preview /api/file count follows loaded meta", () => {
  afterEach(() => {
    setLivePreviewLimits(undefined);
    vi.unstubAllGlobals();
  });

  it("uses meta previewChunk after loadMetaResponse, not 160 or previewLines", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/meta")) {
        return Promise.resolve(jsonResponse(META));
      }
      if (url.includes("/api/file")) {
        return Promise.resolve(
          jsonResponse({
            path: "ok.txt",
            startLine: 1,
            lineCount: 1,
            truncated: false,
            binary: false,
            eof: true,
            lines: [{ n: 1, text: "ok" }],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: false }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await loadMetaResponse();
    expect(meta.ok).toBe(true);
    if (meta.ok) {
      expect(meta.meta.limits.previewChunk).toBe(80);
      expect(meta.meta.limits.previewLines).toBe(201);
    }

    await fetchFileWindow({ path: "ok.txt", from: 1 });
    const requestUrl = (input: RequestInfo | URL): string =>
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const fileUrls = fetchMock.mock.calls
      .map((call) => requestUrl(call[0] as RequestInfo | URL))
      .filter((url) => url.includes("/api/file"));
    expect(fileUrls.length).toBe(1);
    const count = new URL(fileUrls[0] ?? "", "http://localhost").searchParams.get(
      "count",
    );
    expect(count).toBe("80");
    expect(count).not.toBe("160");
    expect(count).not.toBe("201");
  });
});
