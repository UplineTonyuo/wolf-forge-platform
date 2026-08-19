import type {
  DashboardBucket,
  DashboardPreset,
  DashboardRange,
  DashboardWindow,
} from "../../domain/dashboard/schema";

/**
 * The one authoritative business timezone.
 *
 * The application had no timezone convention before this: `Intl.DateTimeFormat`
 * is called without a `timeZone` everywhere, so dates render in the server's
 * zone during SSR and the viewer's zone on the client. Three different input
 * conventions also coexist (invoice due dates hardcode +08:00, order due dates
 * use runtime-local midnight, subscription cycles use UTC midnight).
 *
 * The dashboard needs exactly one answer to "when did today start", so it pins
 * one. Asia/Manila matches the existing +08:00 invoice convention
 * (src/lib/invoices/form-data.ts) and observes no DST, so every day boundary is
 * a clean 24 hours apart. The helpers below are still DST-correct, because this
 * constant is the kind of thing that changes.
 */
export const BUSINESS_TIME_ZONE = "Asia/Manila";

type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading a clock in `timeZone` shows at `instant`. */
export function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Missing ${type} while reading ${timeZone}.`);
    return Number(part.value);
  };

  // Intl renders midnight as hour 24 in some engines; normalise it to 0.
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = toWallClock(instant, timeZone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Discard sub-second precision on both sides so the difference is exact.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Resolves a business-timezone wall-clock reading to the UTC instant it names.
 *
 * The offset depends on the instant, and the instant is what we are solving
 * for, so this guesses with the offset at the naive UTC interpretation and then
 * re-checks. One refinement is sufficient for every real zone: offsets never
 * shift by more than a couple of hours, and a second pass would only matter for
 * a wall-clock time that does not exist (the spring-forward gap), where any
 * answer is arbitrary and this one lands just after the transition.
 */
export function fromWallClock(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  const firstGuess = naive - offsetMsAt(new Date(naive), timeZone);
  const refinedOffset = offsetMsAt(new Date(firstGuess), timeZone);
  return new Date(naive - refinedOffset);
}

/** Midnight starting the business day that `instant` falls in. */
function startOfBusinessDay(instant: Date, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone);
  return fromWallClock({ ...wall, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Midnight starting the business day `days` after the one `instant` falls in. */
function addBusinessDays(instant: Date, days: number, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone);
  return fromWallClock(
    { ...wall, day: wall.day + days, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

function startOfBusinessMonth(instant: Date, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone);
  return fromWallClock({ ...wall, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Days in the calendar month `monthsBefore` months prior to `instant`'s month. */
function daysInPreviousMonth(instant: Date, timeZone: string): number {
  const wall = toWallClock(instant, timeZone);
  // Day 0 of a month is the last day of the month before it.
  return new Date(Date.UTC(wall.year, wall.month - 1, 0)).getUTCDate();
}

/** `YYYY-MM-DD` as written on a business-timezone calendar. */
export function toBusinessDateKey(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const wall = toWallClock(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/**
 * Formats an instant in the business timezone.
 *
 * The shared helpers in src/lib/format.ts pass no `timeZone`, so they render in
 * the server's zone during SSR and the viewer's on the client. That is fine for
 * a due date read at a glance, but a dashboard whose figures are bucketed by
 * Manila days must label them with Manila days or the axis contradicts the data.
 */
export function formatBusinessDate(
  value: string | null,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/** Hourly buckets need the time of day, still read in the business timezone. */
export function formatBusinessHour(
  value: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Parses a `YYYY-MM-DD` calendar date into the business-day window it names. */
function windowForDateKey(dateKey: string, timeZone: string): DashboardWindow {
  const match = dateKeyPattern.exec(dateKey.trim());
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, received "${dateKey}".`);

  const [, year, month, day] = match;
  const start = fromWallClock(
    { year: Number(year), month: Number(month), day: Number(day), hour: 0, minute: 0, second: 0 },
    timeZone,
  );
  return { start: start.toISOString(), end: addBusinessDays(start, 1, timeZone).toISOString() };
}

/**
 * Bucket granularity for a resolved span.
 *
 * Derived from the span itself rather than the preset name, so a custom range
 * follows the same rule as an equivalent preset.
 */
export function bucketForSpan(start: Date, end: Date): DashboardBucket {
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days <= 1) return "hour";
  if (days <= 31) return "day";
  return "week";
}

export type ResolveRangeInput = {
  preset: DashboardPreset;
  /** Required for `custom_date`; `YYYY-MM-DD`. */
  date?: string;
  /** Required for `custom_range`; `YYYY-MM-DD`, inclusive of the whole end day. */
  from?: string;
  to?: string;
};

/**
 * Resolves a preset into the window to query and the window to compare against.
 *
 * Boundaries are computed as business-timezone wall-clock times and returned as
 * UTC instants, so Postgres receives unambiguous `timestamptz` values and only
 * needs the zone for bucketing.
 */
export function resolveDashboardRange(
  input: ResolveRangeInput,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): DashboardRange {
  const today = startOfBusinessDay(now, timeZone);
  const tomorrow = addBusinessDays(today, 1, timeZone);

  let start: Date;
  let end: Date;
  let previous: DashboardWindow | null = null;

  switch (input.preset) {
    case "today": {
      start = today;
      end = tomorrow;
      break;
    }
    case "yesterday": {
      start = addBusinessDays(today, -1, timeZone);
      end = today;
      break;
    }
    case "last_7_days": {
      start = addBusinessDays(today, -6, timeZone);
      end = tomorrow;
      break;
    }
    case "last_30_days": {
      start = addBusinessDays(today, -29, timeZone);
      end = tomorrow;
      break;
    }
    case "this_month": {
      start = startOfBusinessMonth(now, timeZone);
      end = tomorrow;

      /*
       * Month-to-date compares against the same slice of the previous calendar
       * month, not against "the preceding N days" — that would straddle two
       * months and compare a partial month against parts of two others.
       *
       * The elapsed day count is clamped to the previous month's length so a
       * 31-day month never asks February for a day it does not have.
       */
      const elapsedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      const previousMonthStart = addBusinessMonthsToStart(start, -1, timeZone);
      const previousMonthLength = daysInPreviousMonth(start, timeZone);
      const previousEnd = addBusinessDays(
        previousMonthStart,
        Math.min(elapsedDays, previousMonthLength),
        timeZone,
      );
      previous = {
        start: previousMonthStart.toISOString(),
        end: previousEnd.toISOString(),
      };
      break;
    }
    case "custom_date": {
      if (!input.date) throw new Error("A custom_date range requires a date.");
      const window = windowForDateKey(input.date, timeZone);
      start = new Date(window.start);
      end = new Date(window.end);
      break;
    }
    case "custom_range": {
      if (!input.from || !input.to) {
        throw new Error("A custom_range requires both from and to dates.");
      }
      // `to` is inclusive of its whole business day, so the window ends at the
      // following midnight.
      start = new Date(windowForDateKey(input.from, timeZone).start);
      end = new Date(windowForDateKey(input.to, timeZone).end);
      break;
    }
  }

  if (end.getTime() <= start.getTime()) {
    throw new Error("The range must end after it starts.");
  }

  /*
   * Every preset except this_month compares against the immediately preceding
   * range of identical length, ending exactly where the current one begins.
   * Expressed in milliseconds rather than days so it stays exact for any span.
   */
  const resolvedPrevious = previous ?? {
    start: new Date(start.getTime() - (end.getTime() - start.getTime())).toISOString(),
    end: start.toISOString(),
  };

  return {
    preset: input.preset,
    start: start.toISOString(),
    end: end.toISOString(),
    bucket: bucketForSpan(start, end),
    timeZone,
    previous: resolvedPrevious,
  };
}

/** Shifts a month-start instant by whole calendar months, staying at midnight. */
function addBusinessMonthsToStart(monthStart: Date, months: number, timeZone: string): Date {
  const wall = toWallClock(monthStart, timeZone);
  return fromWallClock(
    { ...wall, month: wall.month + months, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}
