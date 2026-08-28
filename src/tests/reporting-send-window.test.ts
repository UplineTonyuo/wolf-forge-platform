import { describe, expect, it } from "vitest";
import {
  calendarDateToISO,
  calendarDateToMonthInputValue,
  currentBusinessCalendarDate,
  isWithinReportingWindow,
  monthInputValueToPeriodDate,
  parseCalendarDate,
  reportingWindowBounds,
  type CalendarDate,
} from "../domain/reporting/send-window";
import { BUSINESS_TIME_ZONE } from "../lib/dashboard/date-range";

const AUGUST_2026 = { year: 2026, month: 8 };
const SEPTEMBER_2026 = { year: 2026, month: 9 };
const FEBRUARY_2027 = { year: 2027, month: 2 }; // non-leap
const FEBRUARY_2028 = { year: 2028, month: 2 }; // leap
const DECEMBER_2026 = { year: 2026, month: 12 };

describe("reportingWindowBounds", () => {
  it("August 2026: Aug 28 through Sep 3", () => {
    expect(reportingWindowBounds(AUGUST_2026)).toEqual({
      start: { year: 2026, month: 8, day: 28 },
      end: { year: 2026, month: 9, day: 3 },
    });
  });

  it("September 2026: Sep 27 through Oct 3", () => {
    expect(reportingWindowBounds(SEPTEMBER_2026)).toEqual({
      start: { year: 2026, month: 9, day: 27 },
      end: { year: 2026, month: 10, day: 3 },
    });
  });

  it("February 2027 (non-leap): Feb 25 through Mar 3", () => {
    expect(reportingWindowBounds(FEBRUARY_2027)).toEqual({
      start: { year: 2027, month: 2, day: 25 },
      end: { year: 2027, month: 3, day: 3 },
    });
  });

  it("February 2028 (leap): Feb 26 through Mar 3", () => {
    expect(reportingWindowBounds(FEBRUARY_2028)).toEqual({
      start: { year: 2028, month: 2, day: 26 },
      end: { year: 2028, month: 3, day: 3 },
    });
  });

  it("December 2026: Dec 28, 2026 through Jan 3, 2027 (year boundary)", () => {
    expect(reportingWindowBounds(DECEMBER_2026)).toEqual({
      start: { year: 2026, month: 12, day: 28 },
      end: { year: 2027, month: 1, day: 3 },
    });
  });
});

describe("isWithinReportingWindow — the 40-test date fixture set", () => {
  it("1. Aug 27 -> denied for the August report", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 8, day: 27 })).toBe(false);
  });

  it("2. Aug 28 -> allowed", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 8, day: 28 })).toBe(true);
  });

  it("3. Aug 31 -> allowed", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 8, day: 31 })).toBe(true);
  });

  it("4. Sep 1 -> allowed for the August report", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 9, day: 1 })).toBe(true);
  });

  it("5. Sep 3 -> allowed", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 9, day: 3 })).toBe(true);
  });

  it("6. Sep 4 -> denied", () => {
    expect(isWithinReportingWindow(AUGUST_2026, { year: 2026, month: 9, day: 4 })).toBe(false);
  });

  it("7. Sep 27 -> allowed for the September report", () => {
    expect(isWithinReportingWindow(SEPTEMBER_2026, { year: 2026, month: 9, day: 27 })).toBe(true);
  });

  it("8. Oct 3 -> allowed for the September report", () => {
    expect(isWithinReportingWindow(SEPTEMBER_2026, { year: 2026, month: 10, day: 3 })).toBe(true);
  });

  it("9. Oct 4 -> denied", () => {
    expect(isWithinReportingWindow(SEPTEMBER_2026, { year: 2026, month: 10, day: 4 })).toBe(false);
  });

  it("10. February non-leap handling (2027): Feb 24 denied, Feb 25 allowed, Mar 3 allowed, Mar 4 denied", () => {
    expect(isWithinReportingWindow(FEBRUARY_2027, { year: 2027, month: 2, day: 24 })).toBe(false);
    expect(isWithinReportingWindow(FEBRUARY_2027, { year: 2027, month: 2, day: 25 })).toBe(true);
    expect(isWithinReportingWindow(FEBRUARY_2027, { year: 2027, month: 3, day: 3 })).toBe(true);
    expect(isWithinReportingWindow(FEBRUARY_2027, { year: 2027, month: 3, day: 4 })).toBe(false);
  });

  it("11. February leap-year handling (2028): Feb 25 denied, Feb 26 allowed, Mar 3 allowed, Mar 4 denied", () => {
    expect(isWithinReportingWindow(FEBRUARY_2028, { year: 2028, month: 2, day: 25 })).toBe(false);
    expect(isWithinReportingWindow(FEBRUARY_2028, { year: 2028, month: 2, day: 26 })).toBe(true);
    expect(isWithinReportingWindow(FEBRUARY_2028, { year: 2028, month: 3, day: 3 })).toBe(true);
    expect(isWithinReportingWindow(FEBRUARY_2028, { year: 2028, month: 3, day: 4 })).toBe(false);
  });

  it("12. December -> January year transition: Dec 27 denied, Dec 28 allowed, Jan 3 allowed, Jan 4 denied", () => {
    expect(isWithinReportingWindow(DECEMBER_2026, { year: 2026, month: 12, day: 27 })).toBe(false);
    expect(isWithinReportingWindow(DECEMBER_2026, { year: 2026, month: 12, day: 28 })).toBe(true);
    expect(isWithinReportingWindow(DECEMBER_2026, { year: 2027, month: 1, day: 3 })).toBe(true);
    expect(isWithinReportingWindow(DECEMBER_2026, { year: 2027, month: 1, day: 4 })).toBe(false);
  });
});

describe("currentBusinessCalendarDate — Asia/Manila boundary behavior", () => {
  it("13. reads the Manila calendar date from a UTC instant near the day boundary", () => {
    // 2026-08-27T16:30:00Z is 2026-08-28T00:30 in Asia/Manila (UTC+08:00, no DST).
    const justAfterManilaMidnight = new Date("2026-08-27T16:30:00.000Z");
    expect(currentBusinessCalendarDate(justAfterManilaMidnight, BUSINESS_TIME_ZONE)).toEqual({
      year: 2026,
      month: 8,
      day: 28,
    });

    // One minute earlier is still 2026-08-27 on the Manila calendar.
    const justBeforeManilaMidnight = new Date("2026-08-27T15:59:00.000Z");
    expect(currentBusinessCalendarDate(justBeforeManilaMidnight, BUSINESS_TIME_ZONE)).toEqual({
      year: 2026,
      month: 8,
      day: 27,
    });
  });

  it("does not depend on the runtime's local timezone the way a naive Date read would", () => {
    const instant = new Date("2026-08-27T20:00:00.000Z"); // 2026-08-28T04:00 Manila
    expect(currentBusinessCalendarDate(instant, "America/New_York")).not.toEqual(
      currentBusinessCalendarDate(instant, BUSINESS_TIME_ZONE),
    );
  });
});

describe("wire-format helpers", () => {
  it("round-trips a CalendarDate through the Postgres date ISO shape", () => {
    const date: CalendarDate = { year: 2026, month: 8, day: 28 };
    expect(calendarDateToISO(date)).toBe("2026-08-28");
    expect(parseCalendarDate("2026-08-28")).toEqual(date);
    expect(parseCalendarDate("2026-08-28T00:00:00.000Z")).toEqual(date);
  });

  it("round-trips a CalendarDate through the <input type=month> value shape", () => {
    const date: CalendarDate = { year: 2026, month: 8, day: 1 };
    expect(calendarDateToMonthInputValue(date)).toBe("2026-08");
    expect(monthInputValueToPeriodDate("2026-08")).toBe("2026-08-01");
  });

  it("rejects malformed wire values rather than silently producing a wrong date", () => {
    expect(() => parseCalendarDate("not-a-date")).toThrow();
    expect(() => monthInputValueToPeriodDate("2026")).toThrow();
  });
});
