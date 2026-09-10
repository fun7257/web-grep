import path from "node:path";
import { describe, expect, it } from "vitest";
import { joinUnderRoot, PathSandboxError } from "../src/sandbox/resolvePath.ts";

const win32 = path.win32;
const root = "C:\\web-grep-root";

describe("path.win32 sandbox", () => {
  it("rejects C:\\ as absolute", () => {
    expect(() => joinUnderRoot(root, "C:\\", win32)).toThrow(PathSandboxError);
  });

  it("rejects UNC \\\\server\\share as absolute", () => {
    expect(() => joinUnderRoot(root, "\\\\server\\share", win32)).toThrow(
      PathSandboxError,
    );
  });

  it("rejects foo\\..\\..\\windows as an escape", () => {
    expect(() => joinUnderRoot(root, "foo\\..\\..\\windows", win32)).toThrow(
      PathSandboxError,
    );
  });

  it("rejects mixed separators that escape", () => {
    expect(() => joinUnderRoot(root, "foo/../../windows", win32)).toThrow(
      PathSandboxError,
    );
  });

  it("accepts a relative win32 path under the root", () => {
    expect(joinUnderRoot(root, "foo\\bar", win32)).toBe(
      "C:\\web-grep-root\\foo\\bar",
    );
  });
});
