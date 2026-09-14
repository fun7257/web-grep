/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_RANGE,
  isTimeRange,
  loadTimeRange,
  mtimeAfterMs,
  saveTimeRange,
  startOfLocalDay,
  TIME_RANGE_STORAGE_KEY,
  toggleTimeRange,
} from "../timeRange.ts";

describe("timeRange", () => {
  it("accepts the five presets", () => {
    expect(isTimeRange("1h")).toBe(true);
    expect(isTimeRange("today")).toBe(true);
    expect(isTimeRange("24h")).toBe(true);
    expect(isTimeRange("7d")).toBe(true);
    expect(isTimeRange("30d")).toBe(true);
    expect(isTimeRange("all")).toBe(false);
  });

  it("computes rolling and calendar cutoffs", () => {
    const now = Date.parse("2026-09-14T15:30:00");
    expect(mtimeAfterMs("1h", now)).toBe(now - 3_600_000);
    expect(mtimeAfterMs("24h", now)).toBe(now - 86_400_000);
    expect(mtimeAfterMs("7d", now)).toBe(now - 7 * 86_400_000);
    expect(mtimeAfterMs("30d", now)).toBe(now - 30 * 86_400_000);
    expect(mtimeAfterMs("today", now)).toBe(
      startOfLocalDay(new Date(now)),
    );
  });

  it("toggles off the active preset", () => {
    expect(toggleTimeRange(null, "1h")).toBe("1h");
    expect(toggleTimeRange("1h", "1h")).toBeNull();
    expect(toggleTimeRange("1h", "7d")).toBe("7d");
  });

  it("defaults to today when nothing is stored", () => {
    localStorage.removeItem(TIME_RANGE_STORAGE_KEY);
    expect(DEFAULT_TIME_RANGE).toBe("today");
    expect(loadTimeRange()).toBe("today");
    saveTimeRange(null);
    expect(localStorage.getItem(TIME_RANGE_STORAGE_KEY)).toBe("all");
    expect(loadTimeRange()).toBeNull();
    saveTimeRange("7d");
    expect(loadTimeRange()).toBe("7d");
  });
});
