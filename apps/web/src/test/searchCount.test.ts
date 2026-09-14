import { describe, expect, it } from "vitest";
import { formatSearchCount } from "../searchCount.ts";

describe("formatSearchCount", () => {
  it("keeps small counts as integers", () => {
    expect(formatSearchCount(0)).toBe("0");
    expect(formatSearchCount(28)).toBe("28");
    expect(formatSearchCount(999)).toBe("999");
  });

  it("uses units above 999", () => {
    expect(formatSearchCount(1000)).toBe("1k");
    expect(formatSearchCount(1500)).toBe("1.5k");
    expect(formatSearchCount(12_300)).toBe("12k");
    expect(formatSearchCount(999_000)).toBe("999k");
    expect(formatSearchCount(1_200_000)).toBe("1.2M");
    expect(formatSearchCount(1_000_000_000)).toBe("1B");
  });
});
