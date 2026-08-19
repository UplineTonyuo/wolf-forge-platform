import type { DashboardPreset } from "../../domain/dashboard/schema";

/**
 * Presentation rules for the Dashboard reporting-period control.
 *
 * Pure and timezone-free on purpose: every "today" it needs is passed in as an
 * already resolved Asia/Manila business date key from
 * `toBusinessDateKey()` in ./date-range, so this module can never invent a
 * second definition of the business day. It only shapes the existing
 * `?period=` / `?from=` / `?to=` reporting contract for display.
 */

export type ReportingMenuOption = {
  preset: DashboardPreset;
  label: string;
};

/** The Dashboard reporting window when no query parameters are present. */
export const defaultReportingPreset: DashboardPreset = "this_month";

export const reportingPresetOptions: ReportingMenuOption[] = [
  { preset: "today", label: "Today" },
  { preset: "yesterday", label: "Yesterday" },
  { preset: "last_7_days", label: "7 days" },
  { preset: "this_month", label: "This month" },
];

const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const monthKeyPattern = /^(\d{4})-(\d{2})$/u;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function isReportingDateKey(value: string | undefined | null): value is string {
  return typeof value === "string" && dateKeyPattern.test(value);
}

function parseMonthKey(monthKey: string): { year: number; month: number } | null {
  const match = monthKeyPattern.exec(monthKey);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function addMonths(monthKey: string, delta: number): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;

  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${pad((index % 12) + 1)}`;
}

export function lastDayOfMonth(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;

  const day = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return `${monthKey}-${pad(day)}`;
}

function monthFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options });
}

export function monthCellLabel(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;

  return monthFormatter({ month: "short" })
    .format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

export function monthCellYear(monthKey: string): string {
  return monthKey.slice(0, 4);
}

/**
 * The month cells the range picker offers: at least a rolling year back from
 * the current business month, extended far enough to contain an active custom
 * range, and rounded up to a whole grid row.
 */
/**
 * Month cells for the range picker.
 *
 * Use calendar-year order instead of a rolling last-12-month strip.
 * Each year must read January -> December in order.
 * If the active custom range reaches into an earlier year, include the
 * full January -> December block for that earlier year too.
 */
export function reportingMonthCells(
  businessToday: string,
  _earliestMonthKey?: string,
  options: {
    minimum?: number;
    columns?: number;
    year?: number;
  } = {},
): string[] {
  const current = parseMonthKey(monthKeyOf(businessToday));

  if (!current) return [];

  const displayYear = options.year ?? current.year;

  return Array.from(
    { length: 12 },
    (_, index) =>
      `${String(displayYear).padStart(4, "0")}-${pad(index + 1)}`,
  );
}

/**
 * Month-level range rules.
 *
 * A drag names two months in any order. The earlier month contributes its first
 * calendar day; the later month contributes its final calendar day, except the
 * current month, which ends on today's business date because later days have
 * not happened yet.
 */
export function rangeFromMonths(
  anchorMonth: string,
  focusMonth: string,
  businessToday: string,
): { from: string; to: string } {
  const [startMonth, endMonth] = anchorMonth <= focusMonth
    ? [anchorMonth, focusMonth]
    : [focusMonth, anchorMonth];

  const currentMonth = monthKeyOf(businessToday);

  return {
    from: `${startMonth}-01`,
    to: endMonth >= currentMonth ? businessToday : lastDayOfMonth(endMonth),
  };
}

/**
 * Current business year through today.
 *
 * Reuses the existing custom_range contract so no new Dashboard
 * reporting backend preset is required.
 */
export function yearToDateRange(
  businessToday: string,
): { from: string; to: string } {
  const match = dateKeyPattern.exec(businessToday);

  if (!match) {
    return {
      from: businessToday,
      to: businessToday,
    };
  }

  return {
    from: `${match[1]}-01-01`,
    to: businessToday,
  };
}

export function formatReportingDate(dateKey: string, withYear = false): string {
  const match = dateKeyPattern.exec(dateKey);
  if (!match) return dateKey;

  return monthFormatter({
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

/** "May 1, 2026 to Aug 17, 2026" for the range panel readout. */
export function reportingRangeSummary(from: string, to: string): string {
  return `${formatReportingDate(from, true)} to ${formatReportingDate(to, true)}`;
}

/** "May 1 - Aug 17" for the compact button, with years only when they differ. */
export function compactRangeLabel(from: string, to: string): string {
  const spansYears = from.slice(0, 4) !== to.slice(0, 4);
  return `${formatReportingDate(from, spansYears)} - ${formatReportingDate(to, spansYears)}`;
}

/**
 * The single reporting button's label. Presets read as their menu label; an
 * active custom range reads as the range itself.
 */
export function reportingButtonLabel(input: {
  preset: DashboardPreset;
  from?: string;
  to?: string;
  date?: string;
}): string {
  if (input.preset === "custom_range") {
    return isReportingDateKey(input.from) && isReportingDateKey(input.to)
      ? compactRangeLabel(input.from, input.to)
      : "Range";
  }

  if (input.preset === "custom_date") {
    return isReportingDateKey(input.date) ? formatReportingDate(input.date) : "Range";
  }

  return reportingPresetOptions.find((option) => option.preset === input.preset)?.label
    ?? "This month";
}
