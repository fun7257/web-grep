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

  it("ships S-URL-1 share-restore copy in zh-CN and en-US", () => {
    expect(catalogs["zh-CN"].shareRestored).toBe("已从分享链接恢复条件");
    expect(catalogs["zh-CN"].sharePendingSelect).toBe("待选中 {path}:{line}");
    expect(catalogs["zh-CN"].previewSharePending).toBe(
      "分享链接待选中 {path}:{line}",
    );
    expect(catalogs["en-US"].shareRestored).toContain("share link");
    expect(catalogs["en-US"].sharePendingSelect).toBe(
      "Pending select {path}:{line}",
    );
    expect(catalogs["en-US"].previewSharePending).toContain("{path}:{line}");
  });

  it("ships S-AND filter placeholder copy in zh-CN and en-US", () => {
    expect(catalogs["zh-CN"].queryFilterPlaceholder).toBe("过滤…");
    expect(catalogs["en-US"].queryFilterPlaceholder).toBe("Filter…");
    expect(catalogs["zh-CN"].queryAddFieldShort).toBe("添加");
    expect(catalogs["zh-CN"].queryAndHintShort).toBe("加过滤");
    expect(catalogs["en-US"].queryAddFieldShort).toBe("Add");
    expect(catalogs["en-US"].queryAndHintShort).toBe("to add");
  });

  it("drops unused chip / browse / token copy keys", () => {
    const zh = catalogs["zh-CN"] as Record<string, string>;
    const en = catalogs["en-US"] as Record<string, string>;
    for (const key of [
      "appTagline",
      "queryAdd",
      "tokenPrompt",
      "resultBack",
      "previewDenied",
      "previewBinaryHelper",
      "kbdSearch",
    ]) {
      expect(zh[key]).toBeUndefined();
      expect(en[key]).toBeUndefined();
    }
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
