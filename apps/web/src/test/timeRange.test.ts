/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  isTimeRange,
  loadTimeRange,
  mtimeAfterMs,
  saveTimeRange,
  startOfLocalDay,
  TIME_RANGE_STORAGE_KEY,
  toggleTimeRange,
} from "../timeRange.ts";

describe("timeRange", () => {
  it("accepts the three presets", () => {
    expect(isTimeRange("today")).toBe(true);
    expect(isTimeRange("24h")).toBe(true);
    expect(isTimeRange("7d")).toBe(true);
    expect(isTimeRange("1h")).toBe(false);
    expect(isTimeRange("30d")).toBe(false);
    expect(isTimeRange("all")).toBe(false);
  });

  it("computes rolling and calendar cutoffs", () => {
    const now = Date.parse("2026-09-14T15:30:00");
    expect(mtimeAfterMs("24h", now)).toBe(now - 86_400_000);
    expect(mtimeAfterMs("7d", now)).toBe(now - 7 * 86_400_000);
    expect(mtimeAfterMs("today", now)).toBe(
      startOfLocalDay(new Date(now)),
    );
  });

  it("toggles off the active preset", () => {
    expect(toggleTimeRange(null, "24h")).toBe("24h");
    expect(toggleTimeRange("24h", "24h")).toBeNull();
    expect(toggleTimeRange("24h", "7d")).toBe("7d");
  });

  it("defaults to no range when nothing is stored", () => {
    localStorage.removeItem(TIME_RANGE_STORAGE_KEY);
    expect(loadTimeRange()).toBeNull();
    saveTimeRange(null);
    expect(localStorage.getItem(TIME_RANGE_STORAGE_KEY)).toBe("all");
    expect(loadTimeRange()).toBeNull();
    saveTimeRange("7d");
    expect(loadTimeRange()).toBe("7d");
  });

  it("drops retired 1h and 30d values from storage", () => {
    localStorage.setItem(TIME_RANGE_STORAGE_KEY, "1h");
    expect(loadTimeRange()).toBeNull();
    localStorage.setItem(TIME_RANGE_STORAGE_KEY, "30d");
    expect(loadTimeRange()).toBeNull();
  });
});
