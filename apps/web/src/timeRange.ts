export const TIME_RANGES = ["1h", "today", "24h", "7d", "30d"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const TIME_RANGE_STORAGE_KEY = "web-grep.timeRange.v2";
export const DEFAULT_TIME_RANGE: TimeRange = "today";

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function isTimeRange(value: string | null | undefined): value is TimeRange {
  return (
    value === "1h" ||
    value === "today" ||
    value === "24h" ||
    value === "7d" ||
    value === "30d"
  );
}

export function loadTimeRange(): TimeRange | null {
  try {
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    if (raw === "all") {
      return null;
    }
    if (isTimeRange(raw)) {
      return raw;
    }
    return DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
}

export function saveTimeRange(value: TimeRange | null): void {
  try {
    if (value === null) {
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, "all");
      return;
    }
    localStorage.setItem(TIME_RANGE_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

export function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function mtimeAfterMs(range: TimeRange, now = Date.now()): number {
  switch (range) {
    case "1h":
      return now - HOUR;
    case "today":
      return startOfLocalDay(new Date(now));
    case "24h":
      return now - DAY;
    case "7d":
      return now - 7 * DAY;
    case "30d":
      return now - 30 * DAY;
  }
}

export function timeRangeMsgKey(
  id: TimeRange,
):
  | "timeRange1h"
  | "timeRangeToday"
  | "timeRange24h"
  | "timeRange7d"
  | "timeRange30d" {
  switch (id) {
    case "1h":
      return "timeRange1h";
    case "today":
      return "timeRangeToday";
    case "24h":
      return "timeRange24h";
    case "7d":
      return "timeRange7d";
    case "30d":
      return "timeRange30d";
  }
}

export function toggleTimeRange(
  current: TimeRange | null,
  next: TimeRange,
): TimeRange | null {
  return current === next ? null : next;
}
