import {
  subscriptionStatuses,
  type subscriptionCycleStatuses,
  type subscriptionEndOfMonthPolicies,
  type subscriptionIntervalUnits,
} from "./schema";

/**
 * Subscription calendar projection.
 *
 * Pure, dependency-free, and integer-cent only, so the same rules run on the
 * server adapter and inside the browser component without a second billing
 * implementation. Nothing here reads Supabase: it consumes an already
 * authorized `SubscriptionCalendarSource[]` produced by
 * `SubscriptionCalendarService`, which is the only place row visibility is
 * decided.
 */

export type SubscriptionCalendarPerspective = "owner" | "client";
export type SubscriptionCalendarStatus = (typeof subscriptionStatuses)[number];
type IntervalUnit = (typeof subscriptionIntervalUnits)[number];
type EndOfMonthPolicy = (typeof subscriptionEndOfMonthPolicies)[number];
type CycleStatus = (typeof subscriptionCycleStatuses)[number];

/**
 * Locked indicator rules. NAVY = monthly, GOLD = annual. Any other real plan
 * interval is rendered as a neutral cadence and never borrows either dot.
 */
export type SubscriptionCalendarCadence = "monthly" | "annual" | "other";

export type SubscriptionCalendarItem = {
  name: string;
  quantity: number;
  netAmountCents: number;
};

export type SubscriptionCalendarCycle = {
  dueOn: string;
  status: CycleStatus;
};

export type SubscriptionCalendarSource = {
  subscriptionId: string;
  publicRef: string;
  /** Owner/Admin only. Always null in the client perspective. */
  companyName: string | null;
  /** Client perspective only: who the recurring investment is with. */
  providerName: string | null;
  status: SubscriptionCalendarStatus;
  currency: string;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  anchorDay: number | null;
  endOfMonthPolicy: EndOfMonthPolicy;
  billingAnchor: string;
  startedOn: string | null;
  pausedOn: string | null;
  resumesOn: string | null;
  cancelEffectiveOn: string | null;
  canceledOn: string | null;
  items: SubscriptionCalendarItem[];
  amountCents: number;
  cycles: SubscriptionCalendarCycle[];
};

export type SubscriptionCalendarEntry = {
  key: string;
  date: string;
  subscriptionId: string;
  publicRef: string;
  companyName: string | null;
  providerName: string | null;
  status: SubscriptionCalendarStatus;
  cadence: SubscriptionCalendarCadence;
  cadenceLabel: string;
  perUnitLabel: string;
  amountCents: number;
  currency: string;
  items: SubscriptionCalendarItem[];
  /** "cycle" is a real persisted billing cycle; "projected" is derived recurrence. */
  origin: "cycle" | "projected";
  cycleStatus: CycleStatus | null;
};

export type SubscriptionCalendarRecurringTotal = {
  currency: string;
  monthlyCents: number;
  annualCents: number;
};

export type SubscriptionCalendarSummary = {
  recurringTotals: SubscriptionCalendarRecurringTotal[];
  activeCount: number;
  newThisMonthCount: number;
  monthEntryCount: number;
};

export type SubscriptionCalendarMonth = {
  monthKey: string;
  perspective: SubscriptionCalendarPerspective;
  entriesByDate: Record<string, SubscriptionCalendarEntry[]>;
  summary: SubscriptionCalendarSummary;
};

/**
 * Statuses that still represent money on contract. Paused subscriptions are
 * not billing, and canceled ones have stopped, so neither contributes to a
 * recurring total.
 */
const recurringRevenueStatuses = new Set<SubscriptionCalendarStatus>([
  "active",
  "past_due",
  "pending_cancellation",
]);

/** Cycles that were never going to bill must not appear on the calendar. */
const nonBillingCycleStatuses = new Set<CycleStatus>(["voided", "skipped"]);

const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const monthKeyPattern = /^(\d{4})-(\d{2})$/u;
const dayMs = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDateKey(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = dateKeyPattern.exec(value.slice(0, 10));
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = monthKeyPattern.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToMonthKey(monthKey: string, delta: number): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;

  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${pad((index % 12) + 1)}`;
}

/** Weekday index (0 = Monday) for the first cell of a Monday-first grid. */
export function mondayFirstWeekday(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function monthLabel(monthKey: string, locale = "en"): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
}

/**
 * Net amount for one plan item, in integer cents. A discount can never push a
 * line below zero, and no floating point ever touches the money.
 */
export function planItemNetCents(item: {
  quantity: number;
  unitAmountCents: number;
  unitDiscountCents: number;
}): number {
  const unit = Math.max(item.unitAmountCents - item.unitDiscountCents, 0);
  return item.quantity * unit;
}

/** Subscription recurring total: the sum of its current plan items. */
export function subscriptionRecurringTotalCents(
  items: readonly SubscriptionCalendarItem[],
): number {
  return items.reduce((total, item) => total + item.netAmountCents, 0);
}

/**
 * Maps the real plan interval, never service marketing text. Only month/1 and
 * year/1 earn the locked navy and gold indicators.
 */
export function resolveSubscriptionCadence(
  unit: IntervalUnit,
  count: number,
): { cadence: SubscriptionCalendarCadence; label: string; perUnitLabel: string } {
  if (unit === "month" && count === 1) {
    return { cadence: "monthly", label: "Monthly", perUnitLabel: "/ month" };
  }

  if (unit === "year" && count === 1) {
    return { cadence: "annual", label: "Annual", perUnitLabel: "/ year" };
  }

  const label = count === 1
    ? `Every ${unit}`
    : `Every ${count} ${unit}s`;

  return { cadence: "other", label, perUnitLabel: `/ ${label.toLowerCase()}` };
}

/**
 * Mirrors `private.subscription_add_interval`: month and year intervals step on
 * the anchor-month grid and resolve the anchor day with the plan's
 * end-of-month policy; day and week intervals step on plain calendar days.
 * Nothing here invents a date the backend would not also produce.
 */
export function projectedBillingDatesInMonth(
  source: Pick<
    SubscriptionCalendarSource,
    | "billingAnchor"
    | "intervalUnit"
    | "intervalCount"
    | "anchorDay"
    | "endOfMonthPolicy"
  >,
  monthKey: string,
): string[] {
  const anchor = parseDateKey(source.billingAnchor);
  const target = parseMonthKey(monthKey);
  if (!anchor || !target || source.intervalCount <= 0) return [];

  if (source.intervalUnit === "month" || source.intervalUnit === "year") {
    const step = source.intervalUnit === "year"
      ? source.intervalCount * 12
      : source.intervalCount;

    const delta = (target.year * 12 + target.month - 1)
      - (anchor.year * 12 + anchor.month - 1);

    if (delta < 0 || delta % step !== 0) return [];
    if (delta === 0) return [source.billingAnchor.slice(0, 10)];

    const anchorDay = source.anchorDay ?? anchor.day;
    const lastDay = daysInMonth(target.year, target.month);

    if (anchorDay <= lastDay) {
      return [toDateKey(target.year, target.month, anchorDay)];
    }

    return source.endOfMonthPolicy === "clamp"
      ? [toDateKey(target.year, target.month, lastDay)]
      : [];
  }

  const stepDays = source.intervalUnit === "week"
    ? source.intervalCount * 7
    : source.intervalCount;

  const anchorMs = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
  const monthStartMs = Date.UTC(target.year, target.month - 1, 1);
  const monthEndMs = Date.UTC(
    target.year,
    target.month - 1,
    daysInMonth(target.year, target.month),
  );

  if (monthEndMs < anchorMs) return [];

  const elapsed = Math.max(0, Math.ceil((monthStartMs - anchorMs) / dayMs / stepDays));
  const dates: string[] = [];

  for (let occurrence = elapsed; dates.length <= 31; occurrence += 1) {
    const stamp = anchorMs + occurrence * stepDays * dayMs;
    if (stamp > monthEndMs) break;
    if (stamp >= monthStartMs) {
      const date = new Date(stamp);
      dates.push(
        toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      );
    }
  }

  return dates;
}

/**
 * Lifecycle gate for a derived date. Real persisted cycles are facts and are
 * kept; a projection is only shown while the subscription is actually due to
 * bill on that date.
 */
export function isProjectedDateBillable(
  source: SubscriptionCalendarSource,
  dateKey: string,
): boolean {
  if (source.status === "canceled") return false;
  if (dateKey < source.billingAnchor.slice(0, 10)) return false;
  if (source.canceledOn && dateKey >= source.canceledOn) return false;
  if (source.cancelEffectiveOn && dateKey > source.cancelEffectiveOn) return false;

  if (source.status === "paused" || source.pausedOn) {
    const pausedFrom = source.pausedOn ?? source.billingAnchor.slice(0, 10);
    const pausedUntil = source.resumesOn;
    if (dateKey >= pausedFrom && (!pausedUntil || dateKey < pausedUntil)) return false;
  }

  return true;
}

function billableCycles(
  source: SubscriptionCalendarSource,
  monthKey: string,
): SubscriptionCalendarCycle[] {
  return source.cycles.filter((cycle) => {
    if (monthKeyOf(cycle.dueOn) !== monthKey) return false;
    if (nonBillingCycleStatuses.has(cycle.status)) return false;
    // A cycle still sitting in "scheduled" after cancellation never bills.
    if (source.status === "canceled" && cycle.status === "scheduled") return false;
    return true;
  });
}

function toEntry(
  source: SubscriptionCalendarSource,
  date: string,
  origin: SubscriptionCalendarEntry["origin"],
  cycleStatus: CycleStatus | null,
): SubscriptionCalendarEntry {
  const cadence = resolveSubscriptionCadence(source.intervalUnit, source.intervalCount);

  return {
    key: `${source.subscriptionId}:${date}`,
    date,
    subscriptionId: source.subscriptionId,
    publicRef: source.publicRef,
    companyName: source.companyName,
    providerName: source.providerName,
    status: source.status,
    cadence: cadence.cadence,
    cadenceLabel: cadence.label,
    perUnitLabel: cadence.perUnitLabel,
    amountCents: subscriptionRecurringTotalCents(source.items),
    currency: source.currency,
    items: source.items,
    origin,
    cycleStatus,
  };
}

/**
 * Projects one visible month.
 *
 * Date precedence: a real `subscription_cycles.due_on` in the visible month
 * always wins; only when the month has no cycle at all is the recurrence
 * derived from the plan version and billing anchor.
 */
export function buildSubscriptionCalendarMonth(
  sources: readonly SubscriptionCalendarSource[],
  monthKey: string,
  perspective: SubscriptionCalendarPerspective,
): SubscriptionCalendarMonth {
  const entriesByDate: Record<string, SubscriptionCalendarEntry[]> = {};
  let monthEntryCount = 0;

  const push = (entry: SubscriptionCalendarEntry) => {
    const bucket = entriesByDate[entry.date] ?? [];
    bucket.push(entry);
    entriesByDate[entry.date] = bucket;
    monthEntryCount += 1;
  };

  sources.forEach((source) => {
    const cycles = billableCycles(source, monthKey);

    if (cycles.length > 0) {
      cycles.forEach((cycle) => {
        push(toEntry(source, cycle.dueOn.slice(0, 10), "cycle", cycle.status));
      });
      return;
    }

    projectedBillingDatesInMonth(source, monthKey)
      .filter((date) => isProjectedDateBillable(source, date))
      .forEach((date) => push(toEntry(source, date, "projected", null)));
  });

  Object.values(entriesByDate).forEach((entries) => {
    entries.sort((left, right) => {
      const byName = (left.companyName ?? "").localeCompare(right.companyName ?? "");
      if (byName !== 0) return byName;
      return right.amountCents - left.amountCents;
    });
  });

  const totals = new Map<string, SubscriptionCalendarRecurringTotal>();
  let activeCount = 0;
  let newThisMonthCount = 0;

  sources.forEach((source) => {
    if (source.status === "active") activeCount += 1;
    if (source.startedOn && monthKeyOf(source.startedOn) === monthKey) {
      newThisMonthCount += 1;
    }

    if (!recurringRevenueStatuses.has(source.status)) return;

    const { cadence } = resolveSubscriptionCadence(source.intervalUnit, source.intervalCount);
    if (cadence === "other") return;

    const total = totals.get(source.currency)
      ?? { currency: source.currency, monthlyCents: 0, annualCents: 0 };

    const amount = subscriptionRecurringTotalCents(source.items);
    if (cadence === "monthly") total.monthlyCents += amount;
    else total.annualCents += amount;

    totals.set(source.currency, total);
  });

  return {
    monthKey,
    perspective,
    entriesByDate,
    summary: {
      recurringTotals: [...totals.values()].sort(
        (left, right) =>
          right.monthlyCents + right.annualCents - (left.monthlyCents + left.annualCents),
      ),
      activeCount,
      newThisMonthCount,
      monthEntryCount,
    },
  };
}
