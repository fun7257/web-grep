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

  it("ships L-RAIL collapsed empty copy in zh-CN and en-US", () => {
    expect(catalogs["zh-CN"].treeCollapsed).toBe("左栏已收起");
    expect(catalogs["zh-CN"].treeCollapsedHelper).toBe(
      "点 ▶ 展开；开合状态写入 localStorage",
    );
    expect(catalogs["zh-CN"].treeShow).toBe("展开左栏");
    expect(catalogs["en-US"].treeCollapsed).toBe("Sidebar collapsed");
    expect(catalogs["en-US"].treeCollapsedHelper).toContain("localStorage");
    expect(catalogs["en-US"].treeShow).toBe("Expand sidebar");
  });
});
