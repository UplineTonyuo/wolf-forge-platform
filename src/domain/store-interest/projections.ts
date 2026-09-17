import {
  formatStoreAmount,
  storeCadence,
  storeRecurringLabel,
  type StoreCadence,
} from "../services/store-projections";
import {
  investmentIntentStatusSchema,
  type InvestmentIntentRow,
  type InvestmentIntentStatus,
} from "./schema";

/**
 * The Investment Intent workspace view model.
 *
 * Pure. Money is formatted through the Store's own helpers so the number the
 * client saw on a card and the number William reads before calling them are
 * produced by one implementation.
 */
export type InvestmentIntentView = {
  id: string;
  companyId: string;
  companyName: string;
  serviceId: string;
  serviceName: string;
  categoryName: string | null;
  /** What the Store showed: the recurring label when there is one. */
  priceLabel: string;
  cadence: StoreCadence;
  status: InvestmentIntentStatus;
  inCart: boolean;
  addCount: number;
  /**
   * True when this interest has been dropped and picked back up at least once.
   * An activity signal, never a workflow status -- see `schema.ts`.
   */
  renewed: boolean;
  firstAddedAt: string;
  lastActivityAt: string;
  removedAt: string | null;
  contactedAt: string | null;
  contactedByName: string | null;
  /**
   * The live investment conversation for this pair, when one exists. A row with
   * this set offers to OPEN it; a row without offers to CREATE one. The
   * database still decides -- see `InvestmentIntentRow.active_ticket_id`.
   */
  activeTicketId: string | null;
  activeTicketStatus: string | null;
};

/** Cadence wording matches the cart's short labels rather than inventing a second vocabulary. */
export const intentCadenceLabels: Record<StoreCadence, string> = {
  "one-time": "One-time",
  monthly: "Monthly",
  annual: "Annual",
  other: "Recurring",
};

export function toInvestmentIntentView(row: InvestmentIntentRow): InvestmentIntentView {
  const pricing = {
    price: row.price,
    currency: row.currency,
    recurring: row.recurring,
    recurring_price: row.recurring_price,
    recurring_interval_length: row.recurring_interval_length,
    recurring_interval_unit: row.recurring_interval_unit,
  };

  /*
   * An unrecognised status would mean the database grew a value this build does
   * not know about. Falling back to "new" keeps the row visible and triageable
   * rather than hiding a live buying signal behind a parse error.
   */
  const status = investmentIntentStatusSchema.safeParse(row.status);

  return {
    id: row.intent_id,
    companyId: row.company_id,
    companyName: row.company_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    categoryName: row.folder_name,
    priceLabel: storeRecurringLabel(pricing) ?? formatStoreAmount(row.price, row.currency),
    cadence: storeCadence(pricing),
    status: status.success ? status.data : "new",
    inCart: row.in_cart,
    addCount: row.add_count,
    renewed: row.add_count > 1,
    firstAddedAt: row.first_added_at,
    lastActivityAt: row.last_activity_at,
    removedAt: row.removed_at,
    contactedAt: row.contacted_at,
    contactedByName: row.contacted_by_name,
    /*
     * A status without an id would be a half-answer the menu cannot act on, so
     * the pair is read through one guard rather than independently.
     */
    activeTicketId: row.active_ticket_id ?? null,
    activeTicketStatus: row.active_ticket_id ? (row.active_ticket_status ?? null) : null,
  };
}

export function toInvestmentIntentViews(rows: InvestmentIntentRow[]): InvestmentIntentView[] {
  return rows.map(toInvestmentIntentView);
}

/**
 * Newest buying signal first.
 *
 * The RPC already orders by the same key; re-stating it here keeps the view
 * model honest when it is composed in a test or filtered in the browser.
 */
export function sortByLatestActivity(views: InvestmentIntentView[]): InvestmentIntentView[] {
  return [...views].sort((left, right) => {
    const difference = right.lastActivityAt.localeCompare(left.lastActivityAt);
    return difference !== 0 ? difference : left.id.localeCompare(right.id);
  });
}

export type InvestmentIntentFilter = {
  status?: InvestmentIntentStatus | "all";
  /** Narrows to interests the client currently has selected. */
  inCartOnly?: boolean;
  query?: string;
};

export function filterInvestmentIntents(
  views: InvestmentIntentView[],
  filter: InvestmentIntentFilter,
): InvestmentIntentView[] {
  const needle = filter.query?.trim().toLocaleLowerCase() ?? "";

  return views.filter((view) => {
    if (filter.status && filter.status !== "all" && view.status !== filter.status) return false;
    if (filter.inCartOnly && !view.inCart) return false;
    if (!needle) return true;

    return [view.companyName, view.serviceName, view.categoryName ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });
}

/**
 * The summary strip.
 *
 * Counts only. One-time, monthly and annual money is never summed into a single
 * "pipeline value" -- the cart refuses to do it for the client and there is no
 * more honest way to do it here.
 */
export type InvestmentIntentCounts = {
  total: number;
  inCart: number;
  new: number;
  contacted: number;
  renewed: number;
};

export function investmentIntentCounts(views: InvestmentIntentView[]): InvestmentIntentCounts {
  return {
    total: views.length,
    inCart: views.filter((view) => view.inCart).length,
    new: views.filter((view) => view.status === "new").length,
    contacted: views.filter((view) => view.status === "contacted").length,
    renewed: views.filter((view) => view.renewed).length,
  };
}

/** Per-status totals for the filter pills, so a pill can carry its own count. */
export function investmentIntentStatusCounts(
  views: InvestmentIntentView[],
): Record<InvestmentIntentStatus, number> {
  const counts: Record<InvestmentIntentStatus, number> = {
    new: 0,
    reviewing: 0,
    contacted: 0,
    qualified: 0,
    closed: 0,
    not_interested: 0,
  };

  for (const view of views) counts[view.status] += 1;
  return counts;
}
