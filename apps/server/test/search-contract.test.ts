import path from "node:path";
import {
  type SseDone,
  SseDoneSchema,
  SseErrorSchema,
  type SseEvent,
  type SseHit,
  SseHitSchema,
  SseMetaSchema,
} from "@web-grep/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { createSearchService } from "../src/search/searchService.ts";
import { detectRgBinary } from "../src/search/spawnRg.ts";
import { createFakeEngine } from "./fakeEngine.ts";
import {
  createSearchFixture,
  postSearch,
  testApp,
  testConfig,
} from "./helpers.ts";

type SseFrame =
  | { kind: "comment"; text: string }
  | { kind: "event"; event: string; data: unknown };

function parseSseText(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split("\n\n")) {
    if (block === "") {
      continue;
    }
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        frames.push({ kind: "comment", text: line.slice(1).trim() });
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length === 0) {
      continue;
    }
    frames.push({
      kind: "event",
      event,
      data: JSON.parse(dataLines.join("\n")) as unknown,
    });
  }
  return frames;
}

function eventsFrom(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const frame of parseSseText(text)) {
    if (frame.kind === "comment") {
      continue;
    }
    if (frame.event === "meta") {
      out.push({ event: "meta", data: SseMetaSchema.parse(frame.data) });
    } else if (frame.event === "hit") {
      out.push({ event: "hit", data: SseHitSchema.parse(frame.data) });
    } else if (frame.event === "done") {
      out.push({ event: "done", data: SseDoneSchema.parse(frame.data) });
    } else if (frame.event === "error") {
      out.push({ event: "error", data: SseErrorSchema.parse(frame.data) });
    }
  }
  return out;
}

function isJsonError(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") && !ct.includes("event-stream");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("POST /api/search contract (fake engine)", () => {
  let fixture: Awaited<ReturnType<typeof createSearchFixture>>;

  beforeEach(async () => {
    fixture = await createSearchFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function harness(
    extra: Parameters<typeof testConfig>[0] = {},
    hold?: Promise<void>,
  ) {
    const config = testConfig({
      rootReal: fixture.rootReal,
      rootLabel: path.basename(fixture.rootReal),
      ...extra,
    });
    const searchEngine = createFakeEngine(hold !== undefined ? { hold } : {});
    const search = createSearchService({
      config,
      engine: "rg",
      searchEngine,
    });
    const app = createApp({ config, engine: "rg", search });
    return { app, search };
  }

  async function searchEvents(
    body: unknown,
    extra: Parameters<typeof testConfig>[0] = {},
  ): Promise<{ res: Response; events: SseEvent[]; comments: string[] }> {
    const { app } = harness(extra);
    const res = await postSearch(app, body);
    const text = await res.text();
    const frames = parseSseText(text);
    return {
      res,
      events: eventsFrom(text),
      comments: frames.filter((f) => f.kind === "comment").map((f) => f.text),
    };
  }

  it("returns ≥1 hit then exactly one done for literal and regex", async () => {
    for (const regex of [false, true]) {
      const { res, events } = await searchEvents({
        query: "hello-needle",
        regex,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const hits = events.filter((e) => e.event === "hit");
      const dones = events.filter((e) => e.event === "done");
      const errors = events.filter((e) => e.event === "error");
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(dones).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(events[0]?.event).toBe("meta");
      const done = dones[0]?.data as SseDone;
      expect(done.matchCount).toBe(hits.length);
      expect(done.truncated).toBe(false);
      expect(done.timedOut).toBe(false);
      expect(done.cancelled).toBe(false);
      const paths = new Set(hits.map((h) => (h.data as SseHit).path));
      expect(done.fileCount).toBe(paths.size);
    }
  });

  it("returns HTTP 400 INVALID_PATH JSON for a path outside the sandbox", async () => {
    const { app } = harness();
    const res = await postSearch(app, { query: "hello-needle", path: "../" });
    expect(res.status).toBe(400);
    expect(isJsonError(res)).toBe(true);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_PATH" });
  });

  it("returns HTTP 429 BUSY JSON for a third concurrent search", async () => {
    const hold = deferred();
    const { app, search } = harness({}, hold.promise);
    const first = postSearch(app, { query: "hello-needle" });
    const second = postSearch(app, { query: "hello-needle" });
    const [res1, res2] = await Promise.all([first, second]);
    expect(res1.headers.get("content-type")).toMatch(/event-stream/);
    expect(res2.headers.get("content-type")).toMatch(/event-stream/);
    expect(search.inflightCount).toBe(2);

    const third = await postSearch(app, { query: "hello-needle" });
    expect(third.status).toBe(429);
    expect(isJsonError(third)).toBe(true);
    await expect(third.json()).resolves.toMatchObject({ code: "BUSY" });

    hold.resolve();
    await res1.text();
    await res2.text();
    expect(search.inflightCount).toBe(0);
  });

  it("treats query -n and --json as patterns", async () => {
    const dashN = await searchEvents({ query: "-n", regex: false });
    expect(
      dashN.events.filter((e) => e.event === "hit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(dashN.events.filter((e) => e.event === "done")).toHaveLength(1);

    const jsonFlag = await searchEvents({ query: "--json", regex: false });
    expect(
      jsonFlag.events.filter((e) => e.event === "hit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(jsonFlag.events.filter((e) => e.event === "done")).toHaveLength(1);
  });

  it("emits no hit for a NUL-containing file", async () => {
    const { events } = await searchEvents({ query: "NULNEEDLE", regex: false });
    const hits = events.filter((e) => e.event === "hit");
    expect(hits).toHaveLength(0);
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
  });

  it("emits no hit for a link-out symlink whose target contains the needle", async () => {
    const { events } = await searchEvents({
      query: "LINKOUTNEEDLE",
      regex: false,
    });
    expect(events.filter((e) => e.event === "hit")).toHaveLength(0);
    const done = events.find((e) => e.event === "done")?.data as SseDone;
    expect(done.matchCount).toBe(0);
  });

  it("emits no hits when globInclude is .env", async () => {
    const { events } = await searchEvents({
      query: "SECRET",
      globInclude: [".env"],
      regex: false,
    });
    expect(events.filter((e) => e.event === "hit")).toHaveLength(0);
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
  });

  it("returns inflight to 0 on abort", async () => {
    const hold = deferred();
    const { app, search } = harness({}, hold.promise);
    const ac = new AbortController();
    const res = await postSearch(
      app,
      { query: "hello-needle" },
      { signal: ac.signal },
    );
    expect(search.inflightCount).toBe(1);
    ac.abort();
    await res.body?.cancel();
    await vi.waitFor(() => {
      expect(search.inflightCount).toBe(0);
    });
    hold.resolve();
  });

  it("truncates on emitted hits only", async () => {
    const { events } = await searchEvents({
      query: "TRUNC",
      regex: false,
      maxResults: 3,
    });
    const hits = events.filter((e) => e.event === "hit");
    const dones = events.filter((e) => e.event === "done");
    expect(hits).toHaveLength(3);
    expect(dones).toHaveLength(1);
    const done = dones[0]?.data as SseDone;
    expect(done.truncated).toBe(true);
    expect(done.matchCount).toBe(3);
    expect(done.timedOut).toBe(false);
    expect(hits.every((h) => (h.data as SseHit).path !== ".env")).toBe(true);
    expect(hits.every((h) => (h.data as SseHit).path !== "link-out")).toBe(
      true,
    );
  });

  it("returns HTTP 400 INVALID_QUERY JSON for an empty query", async () => {
    const { app } = harness();
    const res = await postSearch(app, { query: "" });
    expect(res.status).toBe(400);
    expect(isJsonError(res)).toBe(true);
    const body = (await res.json()) as { code: string };
    expect(body).toMatchObject({ code: "INVALID_QUERY" });
    expect(Array.isArray(body)).toBe(false);
  });

  it("ignores : ping comments when parsing SSE", async () => {
    const sample = [
      "event: meta",
      'data: {"searchId":"550e8400-e29b-41d4-a716-446655440000","engine":"rg"}',
      "",
      ": ping",
      "",
      "event: done",
      'data: {"elapsedMs":1,"matchCount":0,"fileCount":0,"truncated":false,"timedOut":false,"cancelled":false}',
      "",
    ].join("\n");
    const events = eventsFrom(sample);
    expect(events.map((e) => e.event)).toEqual(["meta", "done"]);
    expect(parseSseText(sample).some((f) => f.kind === "comment")).toBe(true);
  });

  it("sends done.timedOut when the wall clock expires", async () => {
    const { app } = harness({ timeoutMs: 80 }, new Promise(() => {}));
    const res = await postSearch(app, { query: "hello-needle" });
    const text = await res.text();
    const events = eventsFrom(text);
    const dones = events.filter((e) => e.event === "done");
    expect(dones).toHaveLength(1);
    expect(events.filter((e) => e.event === "error")).toHaveLength(0);
    const done = dones[0];
    expect(done?.event).toBe("done");
    if (done?.event !== "done") {
      return;
    }
    expect(done.data.timedOut).toBe(true);
    expect(done.data.cancelled).toBe(false);
  });
});

describe("POST /api/search engine none", () => {
  it("returns HTTP 503 ENGINE JSON before SSE", async () => {
    const app = testApp();
    const res = await postSearch(app, { query: "hello-needle" });
    expect(res.status).toBe(503);
    expect(isJsonError(res)).toBe(true);
    await expect(res.json()).resolves.toMatchObject({ code: "ENGINE" });
  });
});

const liveRg = process.env.WEB_GREP_TEST_RG === "1";

describe.skipIf(!liveRg)("POST /api/search contract (live rg)", () => {
  let fixture: Awaited<ReturnType<typeof createSearchFixture>>;
  let rgBin: string | undefined;

  beforeEach(async () => {
    fixture = await createSearchFixture();
    rgBin = await detectRgBinary(undefined);
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("searches a known string with the real rg binary", async () => {
    if (rgBin === undefined) {
      return;
    }
    const config = testConfig({
      rootReal: fixture.rootReal,
      rootLabel: path.basename(fixture.rootReal),
    });
    const search = createSearchService({
      config,
      engine: "rg",
      rgBin,
    });
    const app = createApp({ config, engine: "rg", search, rgBin });
    const res = await postSearch(app, { query: "hello-needle", regex: false });
    expect(res.status).toBe(200);
    const events = eventsFrom(await res.text());
    expect(
      events.filter((e) => e.event === "hit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
    expect(events.filter((e) => e.event === "error")).toHaveLength(0);
  });
});
