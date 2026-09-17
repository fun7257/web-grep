import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/index.ts";

describe("i18n catalogs", () => {
  it("has no user-visible ENGINE_UNSUPPORTED or literal-engine copy", () => {
    const dumped = JSON.stringify(catalogs);
    expect(dumped).not.toContain("ENGINE_UNSUPPORTED");
    expect(dumped).not.toContain("literalEngine");
    expect(catalogs["en-US"].errorCodeEngine).toBe("ENGINE");
    expect(catalogs["zh-CN"].errorCodeEngine).toBe("ENGINE");
    expect(catalogs["zh-CN"].engineUnavailable).toBe("搜索引擎不可用");
  });
});
