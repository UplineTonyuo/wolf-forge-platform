import { z } from "zod";
import { timestampSchema } from "../shared";

/**
 * The executive dashboard read model.
 *
 * Every figure here comes from persisted data. Where the schema cannot answer a
 * question honestly the contract says so explicitly rather than substituting a
 * plausible number — see `client_growth.supported`.
 *
 * All money is integer cents. Nothing in this file, the repository, or the
 * aggregate RPC divides by 100; that happens once at render inside
 * `formatCurrencyCents`.
 */

export const dashboardPresets = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
  "custom_date",
  "custom_range",
] as const;
export type DashboardPreset = (typeof dashboardPresets)[number];

export const dashboardBuckets = ["hour", "day", "week"] as const;
export type DashboardBucket = (typeof dashboardBuckets)[number];

/** Client/company lifecycle statuses, mirroring `companies_status_check`. */
export const dashboardClientStatuses = ["contact", "lead", "client", "client_team"] as const;
export type DashboardClientStatus = (typeof dashboardClientStatuses)[number];

/** The longest span a single dashboard query may scan. */
export const maxDashboardRangeDays = 366;

/**
 * A half-open window `[start, end)`.
 *
 * `timestamptz` has microsecond precision, so an inclusive upper bound at
 * 23:59:59.999999 both drops events in the final microsecond and double-counts
 * the instant shared by two adjacent periods. `end` is always the next period's
 * `start`.
 */
export type DashboardWindow = { start: string; end: string };

export type DashboardRange = DashboardWindow & {
  preset: DashboardPreset;
  bucket: DashboardBucket;
  timeZone: string;
  previous: DashboardWindow;
};

export type CurrencyRevenue = {
  currency: string;
  /** Succeeded payments settled inside the window. */
  gross_cents: number;
  /** Succeeded refunds issued inside the window. */
  refunds_cents: number;
  /**
   * gross - refunds. Deliberately not clamped at zero: a period whose refunds
   * exceed its collections genuinely has negative net revenue, and hiding that
   * would misreport the business.
   */
  net_cents: number;
};

export type MetricComparison = {
  current: number;
  previous: number;
  delta: number;
  /** Null when `previous` is 0 — the UI renders "—", never a fabricated 100%. */
  percent_change: number | null;
};

export type TrendPoint = { bucket_start: string; net_cents: number };

export const dashboardTopServicesSchema = z.array(z.object({
  service_id: z.uuid().nullable(),
  name: z.string().min(1),
  paid_orders: z.coerce.number().int().positive(),
})).max(5);
export type DashboardTopService = z.infer<typeof dashboardTopServicesSchema>[number];

export type ClientGrowthPoint = {
  bucket_start: string;
  to_contact: number;
  to_lead: number;
  to_client: number;
  to_client_team: number;
};

export type DashboardOverview = {
  range: DashboardRange;

  revenue: {
    headline_currency: string;
    /** One entry per currency with activity in the window. Never summed across currencies. */
    current: CurrencyRevenue[];
    previous: CurrencyRevenue[];
  };

  /** Orders on fully-paid invoices. See the note on `revenue` divergence below. */
  paid_orders: MetricComparison;

  clients: {
    /** Companies that entered status 'client' during the window. */
    converted: MetricComparison;
    /** Companies created during the window. Every company starts at 'contact'. */
    created: MetricComparison;
  };

  new_subscriptions: MetricComparison;

  /** A snapshot at query time. Deliberately NOT governed by the date filter. */
  active_subscriptions: {
    /** active + past_due + pending_cancellation. Excludes paused, which does not bill. */
    billable: number;
    by_status: { status: string; count: number }[];
  };

  /** One series per currency. Empty buckets are present with `net_cents: 0`. */
  sales_trend: { currency: string; points: TrendPoint[] }[];

  /**
   * Derived from `activity_events`, the only place company status transitions
   * are persisted. Blind before the status column existed, hence `supported`
   * and `tracking_since` rather than a silently empty chart.
   */
  client_growth: {
    supported: boolean;
    tracking_since: string | null;
    points: ClientGrowthPoint[];
  };
};

/**
 * What the repository sends to `app_dashboard_overview`. The window boundaries
 * are already resolved to UTC instants by `src/lib/dashboard/date-range.ts`;
 * the timezone travels along only so Postgres can bucket in business-local time.
 */
export const dashboardQuerySchema = z
  .object({
    start: timestampSchema,
    end: timestampSchema,
    previous_start: timestampSchema,
    previous_end: timestampSchema,
    bucket: z.enum(dashboardBuckets),
    time_zone: z.string().trim().min(1).max(64),
  })
  .superRefine((query, context) => {
    const start = Date.parse(query.start);
    const end = Date.parse(query.end);
    const previousStart = Date.parse(query.previous_start);
    const previousEnd = Date.parse(query.previous_end);

    if (end <= start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "The range must end after it starts.",
      });
    }
    if (previousEnd <= previousStart) {
      context.addIssue({
        code: "custom",
        path: ["previous_end"],
        message: "The comparison range must end after it starts.",
      });
    }
    if (end - start > maxDashboardRangeDays * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: `A range cannot span more than ${maxDashboardRangeDays} days.`,
      });
    }
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** Percent change guarding against a zero baseline, used by the RPC's callers. */
export function toComparison(current: number, previous: number): MetricComparison {
  return {
    current,
    previous,
    delta: current - previous,
    percent_change: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}
