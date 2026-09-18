import { describe, expect, it } from "vitest";
import {
  filterInvestmentIntents,
  investmentIntentCounts,
  investmentIntentStatusCounts,
  sortByLatestActivity,
  toInvestmentIntentView,
  toInvestmentIntentViews,
} from "../domain/store-interest/projections";
import {
  investmentIntentStatusSchema,
  isInvestmentIntentStatus,
  recordStoreInterestSchema,
  setInvestmentIntentStatusSchema,
  type InvestmentIntentRow,
} from "../domain/store-interest/schema";

function row(overrides: Partial<InvestmentIntentRow> = {}): InvestmentIntentRow {
  return {
    intent_id: "intent-1",
    company_id: "company-1",
    company_name: "Northgate Dental",
    service_id: "service-1",
    service_name: "Local SEO",
    folder_name: "Search",
    price: 500,
    currency: "USD",
    recurring: false,
    recurring_price: null,
    recurring_interval_length: null,
    recurring_interval_unit: null,
    status: "new",
    in_cart: true,
    add_count: 1,
    first_added_at: "2026-08-01T10:00:00.000Z",
    last_added_at: "2026-08-01T10:00:00.000Z",
    removed_at: null,
    last_activity_at: "2026-08-01T10:00:00.000Z",
    contacted_at: null,
    contacted_by_profile_id: null,
    contacted_by_name: null,
    updated_at: "2026-08-01T10:00:00.000Z",
    active_ticket_id: null,
    active_ticket_status: null,
    ...overrides,
  };
}

describe("investment intent input contracts", () => {
  it("accepts only service ids and a direction, never a company", () => {
    const parsed = recordStoreInterestSchema.parse({
      serviceIds: ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
      inCart: true,
      // A caller cannot smuggle a company through: zod strips unknown keys.
      companyId: "someone-elses-company",
    });

    expect(parsed).toEqual({
      serviceIds: ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
      inCart: true,
    });
    expect("companyId" in parsed).toBe(false);
  });

  it("refuses more ids than the cart can hold", () => {
    const ids = Array.from({ length: 13 }, () => "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(recordStoreInterestSchema.safeParse({ serviceIds: ids, inCart: true }).success).toBe(
      false,
    );
    expect(recordStoreInterestSchema.safeParse({ serviceIds: [], inCart: true }).success).toBe(
      false,
    );
  });

  it("refuses a workflow status the database would reject", () => {
    expect(
      setInvestmentIntentStatusSchema.safeParse({
        intentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        status: "renewed",
      }).success,
    ).toBe(false);

    expect(isInvestmentIntentStatus("not_interested")).toBe(true);
    expect(isInvestmentIntentStatus("renewed")).toBe(false);
  });

  it("carries exactly the six workflow statuses", () => {
    // Renewed is an activity signal, not a seventh state.
    expect(investmentIntentStatusSchema.options).toEqual([
      "new",
      "reviewing",
      "contacted",
      "qualified",
      "closed",
      "not_interested",
    ]);
  });
});

describe("investment intent projection", () => {
  it("prices a one-time investment the way the Store card did", () => {
    expect(toInvestmentIntentView(row()).priceLabel).toBe("$500");
  });

  it("prices a recurring investment with its cadence, never a merged total", () => {
    const view = toInvestmentIntentView(
      row({
        recurring: true,
        recurring_price: 750,
        recurring_interval_length: 1,
        recurring_interval_unit: "M",
      }),
    );

    expect(view.priceLabel).toBe("$750 / month");
    expect(view.cadence).toBe("monthly");
  });

  it("reads a twelve-month plan as annual, matching the Store", () => {
    const view = toInvestmentIntentView(
      row({
        recurring: true,
        recurring_price: 1200,
        recurring_interval_length: 12,
        recurring_interval_unit: "M",
      }),
    );

    expect(view.cadence).toBe("annual");
  });

  it("marks a re-added interest as renewed without inventing a status", () => {
    const view = toInvestmentIntentView(row({ add_count: 3, status: "closed" }));

    expect(view.renewed).toBe(true);
    expect(view.addCount).toBe(3);
    // The client's renewed interest did not reopen William's decision.
    expect(view.status).toBe("closed");
  });

  it("treats a first, never-removed interest as not renewed", () => {
    expect(toInvestmentIntentView(row()).renewed).toBe(false);
  });

  it("keeps an unknown status visible rather than dropping a live signal", () => {
    expect(toInvestmentIntentView(row({ status: "invented_state" })).status).toBe("new");
  });

  it("carries removal history through the projection", () => {
    const view = toInvestmentIntentView(
      row({ in_cart: false, removed_at: "2026-08-02T10:00:00.000Z" }),
    );

    expect(view.inCart).toBe(false);
    expect(view.removedAt).toBe("2026-08-02T10:00:00.000Z");
    // The first signal is preserved even though the client dropped it.
    expect(view.firstAddedAt).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("investment intent ordering and filtering", () => {
  const views = toInvestmentIntentViews([
    row({
      intent_id: "old",
      company_name: "Older Client",
      last_activity_at: "2026-08-01T10:00:00.000Z",
      status: "contacted",
      in_cart: false,
      removed_at: "2026-08-01T10:00:00.000Z",
    }),
    row({
      intent_id: "newest",
      company_name: "Southgate Legal",
      service_name: "Press Releases",
      last_activity_at: "2026-08-09T10:00:00.000Z",
    }),
    row({
      intent_id: "middle",
      company_name: "Northgate Dental",
      last_activity_at: "2026-08-05T10:00:00.000Z",
      add_count: 2,
    }),
  ]);

  it("leads with the most recent buying signal", () => {
    expect(sortByLatestActivity(views).map((view) => view.id)).toEqual([
      "newest",
      "middle",
      "old",
    ]);
  });

  it("filters by workflow status", () => {
    expect(
      filterInvestmentIntents(views, { status: "contacted" }).map((view) => view.id),
    ).toEqual(["old"]);

    expect(filterInvestmentIntents(views, { status: "all" })).toHaveLength(3);
  });

  it("narrows to what a client is holding right now", () => {
    expect(filterInvestmentIntents(views, { inCartOnly: true }).map((view) => view.id)).toEqual([
      "newest",
      "middle",
    ]);
  });

  it("searches across client, investment and category", () => {
    expect(filterInvestmentIntents(views, { query: "southgate" }).map((view) => view.id)).toEqual([
      "newest",
    ]);

    expect(filterInvestmentIntents(views, { query: "press" }).map((view) => view.id)).toEqual([
      "newest",
    ]);

    expect(filterInvestmentIntents(views, { query: "search" })).toHaveLength(3);
  });

  it("combines a status filter with a search", () => {
    expect(
      filterInvestmentIntents(views, { status: "new", query: "northgate" }).map((view) => view.id),
    ).toEqual(["middle"]);
  });

  it("counts without ever summing money across cadences", () => {
    const counts = investmentIntentCounts(views);

    expect(counts).toEqual({ total: 3, inCart: 2, new: 2, contacted: 1, renewed: 1 });
    // The shape carries no total value, deliberately.
    expect(Object.keys(counts)).not.toContain("value");
  });

  it("counts each workflow status for its filter pill", () => {
    expect(investmentIntentStatusCounts(views)).toEqual({
      new: 2,
      reviewing: 0,
      contacted: 1,
      qualified: 0,
      closed: 0,
      not_interested: 0,
    });
  });
});
