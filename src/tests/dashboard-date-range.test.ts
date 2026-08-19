import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIME_ZONE,
  bucketForSpan,
  formatBusinessDate,
  formatBusinessHour,
  fromWallClock,
  resolveDashboardRange,
  toBusinessDateKey,
  toWallClock,
} from "../lib/dashboard/date-range";
import { formatDate } from "../lib/format";

/**
 * Asia/Manila is UTC+08:00 year round, so a business day starting at midnight
 * local is 16:00 UTC on the previous calendar day. Every fixture below is
 * written out in full rather than computed, so a regression in the helpers
 * cannot quietly move the expectation with it.
 */
const midMorningManila = new Date("2026-08-17T02:30:00.000Z"); // 10:30 on 17 Aug in Manila

function spanDays(range: { start: string; end: string }) {
  return (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
}

describe("business timezone conversion", () => {
  it("reads the Manila wall clock from a UTC instant", () => {
    expect(toWallClock(midMorningManila, BUSINESS_TIME_ZONE)).toEqual({
      year: 2026, month: 8, day: 17, hour: 10, minute: 30, second: 0,
    });
  });

  it("renders midnight as hour 0, not hour 24", () => {
    // 16:00Z is exactly midnight starting 18 Aug in Manila.
    expect(toWallClock(new Date("2026-08-17T16:00:00.000Z"), BUSINESS_TIME_ZONE).hour).toBe(0);
  });

  it("round-trips a wall clock back to the instant it names", () => {
    const wall = { year: 2026, month: 8, day: 17, hour: 0, minute: 0, second: 0 };
    expect(fromWallClock(wall, BUSINESS_TIME_ZONE).toISOString()).toBe("2026-08-16T16:00:00.000Z");
  });

  it("derives the business calendar date, not the UTC one", () => {
    // 23:00 UTC on 16 Aug is already 07:00 on 17 Aug in Manila.
    expect(toBusinessDateKey(new Date("2026-08-16T23:00:00.000Z"))).toBe("2026-08-17");
  });
});

describe("business-timezone labels", () => {
  /*
   * The shared formatDate passes no timeZone, so on a machine west of Manila it
   * renders the previous calendar day for a late-evening instant. Dashboard
   * buckets are cut on Manila days, so their labels must be too.
   */
  it("labels an instant by its business day, not the runtime's", () => {
    // 22:00 UTC on 16 Aug is already 06:00 on 17 Aug in Manila.
    expect(formatBusinessDate("2026-08-16T22:00:00.000Z")).toBe("Aug 17, 2026");
  });

  it("does not depend on the runtime timezone the way formatDate does", () => {
    const lateEvening = "2026-08-16T22:00:00.000Z";
    expect(formatBusinessDate(lateEvening, "Asia/Manila")).toBe("Aug 17, 2026");
    expect(formatBusinessDate(lateEvening, "America/New_York")).toBe("Aug 16, 2026");
    // Whatever formatDate returns here is runtime-dependent; that is the point.
    expect(typeof formatDate(lateEvening)).toBe("string");
  });

  it("renders an em dash for a missing timestamp", () => {
    expect(formatBusinessDate(null)).toBe("—");
  });

  it("labels hourly buckets with the business-local time", () => {
    expect(formatBusinessHour("2026-08-16T16:00:00.000Z")).toBe("12:00 AM");
    expect(formatBusinessHour("2026-08-17T01:00:00.000Z")).toBe("9:00 AM");
  });
});

describe("presets", () => {
  it("resolves today to the business day containing now", () => {
    const range = resolveDashboardRange({ preset: "today" }, midMorningManila);
    expect(range.start).toBe("2026-08-16T16:00:00.000Z");
    expect(range.end).toBe("2026-08-17T16:00:00.000Z");
    expect(range.timeZone).toBe("Asia/Manila");
  });

  it("compares today against yesterday", () => {
    const range = resolveDashboardRange({ preset: "today" }, midMorningManila);
    expect(range.previous).toEqual({
      start: "2026-08-15T16:00:00.000Z",
      end: "2026-08-16T16:00:00.000Z",
    });
  });

  it("resolves yesterday and compares against the day before", () => {
    const range = resolveDashboardRange({ preset: "yesterday" }, midMorningManila);
    expect(range.start).toBe("2026-08-15T16:00:00.000Z");
    expect(range.end).toBe("2026-08-16T16:00:00.000Z");
    expect(range.previous.start).toBe("2026-08-14T16:00:00.000Z");
  });

  it("spans exactly 7 days for last_7_days, including today", () => {
    const range = resolveDashboardRange({ preset: "last_7_days" }, midMorningManila);
    expect(spanDays(range)).toBe(7);
    expect(range.end).toBe("2026-08-17T16:00:00.000Z");
    expect(spanDays(range.previous)).toBe(7);
    expect(range.previous.end).toBe(range.start);
  });

  it("spans exactly 30 days for last_30_days", () => {
    const range = resolveDashboardRange({ preset: "last_30_days" }, midMorningManila);
    expect(spanDays(range)).toBe(30);
    expect(spanDays(range.previous)).toBe(30);
  });
});

describe("this_month comparison", () => {
  it("runs month-to-date and compares against the same slice of last month", () => {
    const range = resolveDashboardRange({ preset: "this_month" }, midMorningManila);
    // 1 Aug 00:00 Manila through 18 Aug 00:00 Manila = 17 elapsed days.
    expect(range.start).toBe("2026-07-31T16:00:00.000Z");
    expect(spanDays(range)).toBe(17);
    // July has 31 days, so 17 fits without clamping.
    expect(range.previous.start).toBe("2026-06-30T16:00:00.000Z");
    expect(spanDays(range.previous)).toBe(17);
  });

  it("clamps to the previous month's length when it is shorter", () => {
    // 31 March: 31 elapsed days month-to-date, but February 2026 has only 28.
    const lateMarch = new Date("2026-03-31T02:00:00.000Z");
    const range = resolveDashboardRange({ preset: "this_month" }, lateMarch);
    expect(spanDays(range)).toBe(31);
    expect(range.previous.start).toBe("2026-01-31T16:00:00.000Z"); // 1 Feb Manila
    expect(spanDays(range.previous)).toBe(28);
  });

  it("does not compare a partial month against a window straddling two months", () => {
    const range = resolveDashboardRange({ preset: "this_month" }, midMorningManila);
    // The comparison must begin on the 1st of the previous month.
    expect(toBusinessDateKey(new Date(range.previous.start))).toBe("2026-07-01");
  });
});

describe("custom ranges", () => {
  it("treats a custom date as one whole business day", () => {
    const range = resolveDashboardRange({ preset: "custom_date", date: "2026-08-05" });
    expect(range.start).toBe("2026-08-04T16:00:00.000Z");
    expect(range.end).toBe("2026-08-05T16:00:00.000Z");
    expect(range.previous.start).toBe("2026-08-03T16:00:00.000Z");
  });

  it("includes the whole final day of a custom range", () => {
    const range = resolveDashboardRange({ preset: "custom_range", from: "2026-08-01", to: "2026-08-15" });
    expect(range.start).toBe("2026-07-31T16:00:00.000Z");
    expect(range.end).toBe("2026-08-15T16:00:00.000Z"); // midnight ending 15 Aug
    expect(spanDays(range)).toBe(15);
  });

  it("compares a custom range against the preceding equal-length range", () => {
    const range = resolveDashboardRange({ preset: "custom_range", from: "2026-08-01", to: "2026-08-15" });
    expect(spanDays(range.previous)).toBe(15);
    expect(range.previous.end).toBe(range.start);
    expect(range.previous.start).toBe("2026-07-16T16:00:00.000Z");
  });

  it("rejects an inverted custom range", () => {
    expect(() =>
      resolveDashboardRange({ preset: "custom_range", from: "2026-08-15", to: "2026-08-01" }),
    ).toThrow(/must end after it starts/u);
  });

  it("rejects a custom range missing its bounds", () => {
    expect(() => resolveDashboardRange({ preset: "custom_range", from: "2026-08-01" })).toThrow();
    expect(() => resolveDashboardRange({ preset: "custom_date" })).toThrow();
  });
});

describe("bucket selection", () => {
  it("uses hourly buckets for a single day", () => {
    expect(resolveDashboardRange({ preset: "today" }, midMorningManila).bucket).toBe("hour");
    expect(resolveDashboardRange({ preset: "custom_date", date: "2026-08-05" }).bucket).toBe("hour");
  });

  it("uses daily buckets up to 31 days and weekly beyond", () => {
    expect(resolveDashboardRange({ preset: "last_7_days" }, midMorningManila).bucket).toBe("day");
    expect(resolveDashboardRange({ preset: "last_30_days" }, midMorningManila).bucket).toBe("day");

    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(bucketForSpan(start, new Date("2026-02-01T00:00:00.000Z"))).toBe("day"); // 31 days
    expect(bucketForSpan(start, new Date("2026-02-02T00:00:00.000Z"))).toBe("week"); // 32 days
  });
});

describe("daylight saving correctness", () => {
  /*
   * Asia/Manila has no DST, so these run against America/New_York to prove the
   * helpers do not assume a fixed offset. US DST began 8 March 2026.
   */
  const newYork = "America/New_York";

  it("produces a 23-hour day across spring forward", () => {
    const duringSpringForward = new Date("2026-03-08T12:00:00.000Z"); // 08:00 EDT
    const range = resolveDashboardRange({ preset: "today" }, duringSpringForward, newYork);
    const hours = (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000;
    expect(hours).toBe(23);
  });

  it("produces a 25-hour day across fall back", () => {
    const duringFallBack = new Date("2026-11-01T12:00:00.000Z"); // 07:00 EST
    const range = resolveDashboardRange({ preset: "today" }, duringFallBack, newYork);
    const hours = (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000;
    expect(hours).toBe(25);
  });

  it("keeps daily boundaries at local midnight across a DST transition", () => {
    const afterTransition = new Date("2026-03-10T12:00:00.000Z");
    const range = resolveDashboardRange({ preset: "last_7_days" }, afterTransition, newYork);
    // The span is one hour short of 7×24h because a day was lost to the shift.
    expect(Date.parse(range.end) - Date.parse(range.start)).toBe(7 * 86_400_000 - 3_600_000);
    expect(toWallClock(new Date(range.start), newYork).hour).toBe(0);
    expect(toWallClock(new Date(range.end), newYork).hour).toBe(0);
  });
});
