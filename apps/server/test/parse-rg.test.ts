import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRgMatchLine } from "../src/search/parseRgJson.ts";
import {
  toRelativeHit,
  utf8ByteOffsetToUtf16,
} from "../src/search/toRelativeHit.ts";
import { createSearchFixture } from "./helpers.ts";

const fixtureFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "rg-match.jsonl",
);

describe("parseRgJson + toRelativeHit", () => {
  let fixture: Awaited<ReturnType<typeof createSearchFixture>>;

  beforeEach(async () => {
    fixture = await createSearchFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("converts CJK byte offsets to UTF-16 and drops absolute paths", async () => {
    const jsonl = await readFile(fixtureFile, "utf8");
    const matches = jsonl
      .split("\n")
      .filter((line) => line.length > 0)
      .map(parseRgMatchLine)
      .filter((m) => m !== undefined);

    expect(matches).toHaveLength(2);
    const cjk = matches[0];
    const abs = matches[1];
    expect(cjk?.path).toBe("cjk.txt");
    expect(cjk?.submatches[0]).toEqual({ start: 6, end: 9 });
    expect(utf8ByteOffsetToUtf16("hello 你 world", 6)).toBe(6);
    expect(utf8ByteOffsetToUtf16("hello 你 world", 9)).toBe(7);

    const cjkHit = await toRelativeHit(fixture.rootReal, false, {
      path: "cjk.txt",
      line: 1,
      text: "hello 你 world\n",
      submatches: [{ start: 6, end: 9 }],
    });
    expect(cjkHit).toMatchObject({
      path: "cjk.txt",
      line: 1,
      text: "hello 你 world",
      matches: [{ start: 6, end: 7 }],
    });

    expect(abs?.path).toBe("/etc/passwd");
    await expect(
      toRelativeHit(
        fixture.rootReal,
        false,
        abs ?? {
          path: "/etc/passwd",
          line: 1,
          text: "root:x:0:0\n",
          submatches: [],
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("drops a link-out match whose realpath escapes the root", async () => {
    const hit = await toRelativeHit(fixture.rootReal, false, {
      path: "link-out",
      line: 1,
      text: "LINKOUTNEEDLE\n",
      submatches: [{ start: 0, end: 13 }],
    });
    expect(hit).toBeUndefined();
  });

  it("drops denied secret files", async () => {
    const hit = await toRelativeHit(fixture.rootReal, false, {
      path: ".env",
      line: 1,
      text: "SECRET=1\n",
      submatches: [{ start: 0, end: 6 }],
    });
    expect(hit).toBeUndefined();
  });
});
