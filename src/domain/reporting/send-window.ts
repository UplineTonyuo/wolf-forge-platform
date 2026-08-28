import { BUSINESS_TIME_ZONE, toWallClock } from "../../lib/dashboard/date-range";

/**
 * The monthly reporting send-window engine.
 *
 * Mirrors `private.reporting_window_bounds` /
 * `private.report_send_authorized_for_period` in
 * `supabase/migrations/20260827130000_reporting_send_window.sql` exactly — one
 * formula, one runtime each, because SQL and TypeScript cannot share a
 * function body. The database is the authority for every actual send
 * decision; this module exists so the UI can render the same window without
 * a round trip, and so the formula has one place to be unit tested against
 * the full fixture set (month/year/leap-year boundaries).
 *
 * Deliberately uses real calendar arithmetic (UTC-anchored day math), never
 * string slicing and never a hardcoded month-length table.
 */

export type CalendarDate = {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
};

export type ReportingPeriodMonth = {
  year: number;
  /** 1-12. */
  month: number;
};

export type ReportingWindow = {
  start: CalendarDate;
  end: CalendarDate;
};

function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: CalendarDate, delta: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year < b.year ? -1 : 1;
  if (a.month !== b.month) return a.month < b.month ? -1 : 1;
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return 0;
}

/**
 * monthEnd = the real last calendar day of `periodMonth`.
 * window = [monthEnd - 3 days, monthEnd + 3 days], both inclusive.
 */
export function reportingWindowBounds(periodMonth: ReportingPeriodMonth): ReportingWindow {
  const monthEnd: CalendarDate = {
    year: periodMonth.year,
    month: periodMonth.month,
    day: daysInMonth(periodMonth.year, periodMonth.month),
  };

  return { start: addDays(monthEnd, -3), end: addDays(monthEnd, 3) };
}

export function isWithinReportingWindow(
  periodMonth: ReportingPeriodMonth,
  today: CalendarDate,
): boolean {
  const { start, end } = reportingWindowBounds(periodMonth);
  return compareCalendarDates(today, start) >= 0 && compareCalendarDates(today, end) <= 0;
}

/** The Wolf Forge business calendar date "now" — Asia/Manila, never the browser's clock. */
export function currentBusinessCalendarDate(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): CalendarDate {
  const wall = toWallClock(now, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD`, matching the Postgres `date` wire format. */
export function calendarDateToISO(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** Parses a `YYYY-MM-DD` (or a `YYYY-MM-DDTHH:mm:ss...` timestamp prefix) into a CalendarDate. */
export function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value.trim());
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, received "${value}".`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `YYYY-MM`, the value shape a native `<input type="month">` uses. */
export function calendarDateToMonthInputValue(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}`;
}

/** Parses a `YYYY-MM` month-input value into the first-of-month `YYYY-MM-01` the database stores. */
export function monthInputValueToPeriodDate(value: string): string {
  const match = /^(\d{4})-(\d{2})$/u.exec(value.trim());
  if (!match) throw new Error(`Expected a YYYY-MM month, received "${value}".`);
  return `${match[1]}-${match[2]}-01`;
}
