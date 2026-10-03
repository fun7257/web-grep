import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/index.ts";

describe("i18n catalogs", () => {
  it("ships row-expand copy with the same placeholders in zh-CN and en-US", () => {
    expect(catalogs["zh-CN"].resultLongLine).toBe("长行 {n} 字符");
    expect(catalogs["zh-CN"].resultFullLine).toBe("整行 {n} 字符");
    expect(catalogs["zh-CN"].resultExpandHint).toBe("点击在右侧渲染");
    expect(catalogs["zh-CN"].resultExpandSkip).toBe("省略 {n} 字符");
    expect(catalogs["zh-CN"].resultExpandCapNote).toBe(
      "为了不占满列表，只展开行首和命中附近",
    );
    const keys = [
      "resultLongLine",
      "resultFullLine",
      "resultExpandHint",
      "resultExpandSkip",
      "resultExpandCapNote",
    ] as const;
    for (const key of keys) {
      const placeholders = (value: string) => value.match(/\{[a-z]+\}/g);
      expect(placeholders(catalogs["en-US"][key])).toEqual(
        placeholders(catalogs["zh-CN"][key]),
      );
      expect(catalogs["en-US"][key].length).toBeGreaterThan(0);
    }
  });

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
    expect(catalogs["zh-CN"].filterPlaceholder).toBe("再加一个必须命中的词…");
    expect(catalogs["en-US"].filterPlaceholder).toBe(
      "Another term that must match…",
    );
    expect(catalogs["zh-CN"].filterAddShort).toBe("添加");
    expect(catalogs["zh-CN"].filterAddHintShort).toBe("加过滤");
    expect(catalogs["en-US"].filterAddShort).toBe("Add");
    expect(catalogs["en-US"].filterAddHintShort).toBe("to add");
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
