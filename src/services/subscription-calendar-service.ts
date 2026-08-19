import type {
  SubscriptionCalendarItem,
  SubscriptionCalendarPerspective,
  SubscriptionCalendarSource,
} from "../domain/subscriptions/calendar";
import { planItemNetCents } from "../domain/subscriptions/calendar";
import type { SubscriptionDetail, SubscriptionSummary } from "../domain/subscriptions/schema";
import { toBusinessDateKey } from "../lib/dashboard/date-range";
import type { SubscriptionRepository } from "../repositories/subscription-repository";
import type { ServiceDependencies } from "./mutation-context";

/**
 * Read adapter for the Subscription calendar.
 *
 * It owns no billing rules of its own: it reuses the existing authorized
 * Subscription read models (`app_list_subscription_summaries` and
 * `app_get_subscription_detail`, both `private.can_read_subscription` gated)
 * and reshapes them into the pure `SubscriptionCalendarSource` the domain
 * projection consumes.
 *
 * Row visibility is therefore decided by the database, not by this class: an
 * Owner/Admin session receives every company it may read, a client session
 * receives only its own company's subscriptions. The `perspective` argument
 * only removes fields a client must never even receive.
 */
export const wolfForgeProviderName = "Wolf Forge";

export class SubscriptionCalendarService {
  constructor(private readonly dependencies: ServiceDependencies<SubscriptionRepository>) {}

  async listSources(
    perspective: SubscriptionCalendarPerspective,
  ): Promise<SubscriptionCalendarSource[]> {
    const summaries = await this.dependencies.repository.list();

    const details = await Promise.all(
      summaries.map((summary) =>
        this.dependencies.repository
          .getById(summary.subscription_id)
          /*
           * One unreadable subscription must not blank the whole calendar; the
           * remaining authorized rows still project correctly.
           */
          .catch(() => null),
      ),
    );

    return summaries.flatMap((summary, index) => {
      const detail = details[index];
      return detail ? [toCalendarSource(summary, detail, perspective)] : [];
    });
  }
}

function toDateKey(value: string | null): string | null {
  if (!value) return null;
  // `date` columns arrive as YYYY-MM-DD; timestamptz is cut on the business day.
  if (value.length === 10) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toBusinessDateKey(parsed);
}

function toCalendarSource(
  summary: SubscriptionSummary,
  detail: SubscriptionDetail,
  perspective: SubscriptionCalendarPerspective,
): SubscriptionCalendarSource {
  const { subscription, current_plan: plan, plan_items: planItems, cycles } = detail;

  const items: SubscriptionCalendarItem[] = planItems.map((item) => ({
    name: item.service_name_snapshot,
    quantity: item.quantity,
    netAmountCents: planItemNetCents({
      quantity: item.quantity,
      unitAmountCents: item.unit_amount_cents,
      unitDiscountCents: item.unit_discount_cents,
    }),
  }));

  const isOwner = perspective === "owner";

  /*
   * A subscription always has at least one plan item, but the summary total is
   * a safe fallback rather than rendering a day entry with no money on it.
   */
  const resolvedItems: SubscriptionCalendarItem[] = items.length > 0
    ? items
    : [{ name: summary.service_name, quantity: 1, netAmountCents: summary.amount_cents }];

  return {
    subscriptionId: summary.subscription_id,
    publicRef: summary.public_ref,
    companyName: isOwner ? summary.company_name : null,
    providerName: isOwner ? null : wolfForgeProviderName,
    status: summary.status,
    currency: plan.currency,
    intervalUnit: plan.interval_unit,
    intervalCount: plan.interval_count,
    anchorDay: plan.anchor_day,
    endOfMonthPolicy: plan.end_of_month_policy,
    billingAnchor: subscription.billing_anchor,
    startedOn: toDateKey(subscription.started_at),
    pausedOn: toDateKey(subscription.paused_at),
    resumesOn: toDateKey(subscription.resumes_at),
    cancelEffectiveOn: toDateKey(subscription.cancel_effective_at),
    canceledOn: toDateKey(subscription.canceled_at),
    items: resolvedItems,
    amountCents: resolvedItems.reduce((total, item) => total + item.netAmountCents, 0),
    cycles: cycles.map((cycle) => ({ dueOn: cycle.due_on, status: cycle.status })),
  };
}
