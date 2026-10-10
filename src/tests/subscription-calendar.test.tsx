/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const visibility = vi.hoisted(() => ({ read: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("../app/actions/subscriptions", () => ({ loadSubscriptionVisibilityAction: visibility.read }));
vi.mock("next/navigation", () => ({ useRouter: () => visibility.router }));
import { SubscriptionCalendarModal, SubscriptionCalendarPanel } from "../components/subscriptions/subscription-calendar";
import type { SubscriptionCalendarResult } from "../app/actions/subscription-calendar";
import {
  buildSubscriptionCalendarMonth,
  planItemNetCents,
  projectedBillingDatesInMonth,
  resolveSubscriptionCadence,
  subscriptionRecurringTotalCents,
  type SubscriptionCalendarSource,
} from "../domain/subscriptions/calendar";
import type { SubscriptionDetail, SubscriptionSummary } from "../domain/subscriptions/schema";
import type { SubscriptionRepository } from "../repositories/subscription-repository";
import { SubscriptionCalendarService } from "../services/subscription-calendar-service";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* jsdom serves import.meta.url over http, so the source tree is resolved from the project root. */
const sourceRoot = resolve(process.cwd(), "src");

function ownerSource(
  overrides: Partial<SubscriptionCalendarSource> = {},
): SubscriptionCalendarSource {
  return {
    subscriptionId: "sub-kraken",
    publicRef: "WFA1B2C3D4",
    companyName: "Kraken Junk Removal",
    providerName: null,
    status: "active",
    currency: "USD",
    intervalUnit: "month",
    intervalCount: 1,
    anchorDay: 15,
    endOfMonthPolicy: "clamp",
    billingAnchor: "2026-05-15",
    startedOn: "2026-05-15",
    pausedOn: null,
    resumesOn: null,
    cancelEffectiveOn: null,
    canceledOn: null,
    items: [{ name: "Local SEO", quantity: 1, netAmountCents: 49_900 }],
    amountCents: 49_900,
    cycles: [],
    ...overrides,
  };
}

const blueKoi = ownerSource({
  subscriptionId: "sub-blue-koi",
  publicRef: "WFE5F6A7B8",
  companyName: "Blue Koi Hauling",
  items: [{ name: "Website Care", quantity: 1, netAmountCents: 14_900 }],
  amountCents: 14_900,
});

const annualSource = ownerSource({
  subscriptionId: "sub-summit",
  publicRef: "WFC9D0E1F2",
  companyName: "Summit Financial Group",
  intervalUnit: "year",
  intervalCount: 1,
  anchorDay: 24,
  billingAnchor: "2025-08-24",
  startedOn: "2025-08-24",
  items: [{ name: "Enterprise SEO Retainer", quantity: 1, netAmountCents: 240_000 }],
  amountCents: 240_000,
});

it("rejects an old Calendar feed after current denial even if the refresh fails", async () => {
  let resolveOld!: (result: SubscriptionCalendarResult) => void;
  const oldFeed = new Promise<SubscriptionCalendarResult>((resolve) => { resolveOld = resolve; });
  const loadSources = vi.fn()
    .mockReturnValueOnce(oldFeed)
    .mockRejectedValue(new Error("Transient transport failure"));
  visibility.read.mockResolvedValueOnce({ ok: false, denied: true })
    .mockResolvedValue({ ok: false, denied: false });

  render(<SubscriptionCalendarModal perspective="owner" loadSources={loadSources} onClose={vi.fn()} />);
  await screen.findByRole("alert");
  await waitFor(() => expect(loadSources).toHaveBeenCalledTimes(2));
  await act(async () => { resolveOld({ ok: true, sources: [ownerSource()] }); });

  expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  expect(screen.queryByText("Recurring revenue calendar")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Close$/ })).toBeInTheDocument();
});

it("returns Calendar focus to its opener after closing", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  visibility.read.mockResolvedValue({ ok: true, ids: [], states: [] });
  const loadSources = vi.fn(async (): Promise<SubscriptionCalendarResult> => ({ ok: true, sources: [] }));
  const { unmount } = render(<SubscriptionCalendarModal perspective="client" loadSources={loadSources} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

describe("subscription calendar money", () => {
  it("keeps plan item maths in integer cents and floors a discount at zero", () => {
    expect(planItemNetCents({ quantity: 3, unitAmountCents: 49_900, unitDiscountCents: 4_990 }))
      .toBe(134_730);
    expect(planItemNetCents({ quantity: 1, unitAmountCents: 1_000, unitDiscountCents: 5_000 }))
      .toBe(0);
    expect(Number.isInteger(
      planItemNetCents({ quantity: 7, unitAmountCents: 3_333, unitDiscountCents: 1_111 }),
    )).toBe(true);
  });

  it("aggregates multiple plan items into one subscription total", () => {
    const items = [
      { name: "Local SEO", quantity: 1, netAmountCents: 49_900 },
      { name: "Website Care", quantity: 2, netAmountCents: 29_800 },
    ];

    expect(subscriptionRecurringTotalCents(items)).toBe(79_700);
  });

  it("totals recurring revenue per currency without floating point", () => {
    const month = buildSubscriptionCalendarMonth(
      [ownerSource(), blueKoi, annualSource],
      "2026-08",
      "owner",
    );

    expect(month.summary.recurringTotals).toEqual([
      { currency: "USD", monthlyCents: 64_800, annualCents: 240_000 },
    ]);
    expect(month.summary.activeCount).toBe(3);
  });

  it("counts subscriptions started in the visible month only", () => {
    const month = buildSubscriptionCalendarMonth(
      [ownerSource({ startedOn: "2026-08-15" }), blueKoi, annualSource],
      "2026-08",
      "owner",
    );

    expect(month.summary.newThisMonthCount).toBe(1);
  });
});

describe("cadence mapping", () => {
  it("maps the real plan interval and never borrows a monthly or annual dot", () => {
    expect(resolveSubscriptionCadence("month", 1).cadence).toBe("monthly");
    expect(resolveSubscriptionCadence("year", 1).cadence).toBe("annual");
    expect(resolveSubscriptionCadence("month", 3)).toMatchObject({
      cadence: "other",
      label: "Every 3 months",
    });
    expect(resolveSubscriptionCadence("week", 2).cadence).toBe("other");
  });

  it("excludes non monthly/annual cadences from the recurring totals", () => {
    const quarterly = ownerSource({ intervalCount: 3, amountCents: 99_900, items: [
      { name: "Quarterly Sprint", quantity: 1, netAmountCents: 99_900 },
    ] });

    const month = buildSubscriptionCalendarMonth([quarterly], "2026-08", "owner");
    expect(month.summary.recurringTotals).toEqual([]);
  });
});

describe("calendar date derivation", () => {
  it("derives the visible-month recurrence from the plan anchor", () => {
    expect(projectedBillingDatesInMonth(ownerSource(), "2026-08")).toEqual(["2026-08-15"]);
    expect(projectedBillingDatesInMonth(ownerSource(), "2026-04")).toEqual([]);
    expect(projectedBillingDatesInMonth(ownerSource(), "2026-05")).toEqual(["2026-05-15"]);
  });

  it("respects interval_count instead of assuming every month bills", () => {
    const quarterly = ownerSource({ intervalCount: 3 });

    expect(projectedBillingDatesInMonth(quarterly, "2026-08")).toEqual(["2026-08-15"]);
    expect(projectedBillingDatesInMonth(quarterly, "2026-09")).toEqual([]);
    expect(projectedBillingDatesInMonth(quarterly, "2026-11")).toEqual(["2026-11-15"]);
  });

  it("applies the plan end-of-month policy the backend uses", () => {
    const clamped = ownerSource({ billingAnchor: "2026-01-31", anchorDay: 31 });
    const skipped = ownerSource({
      billingAnchor: "2026-01-31",
      anchorDay: 31,
      endOfMonthPolicy: "skip",
    });

    expect(projectedBillingDatesInMonth(clamped, "2026-02")).toEqual(["2026-02-28"]);
    expect(projectedBillingDatesInMonth(skipped, "2026-02")).toEqual([]);
    expect(projectedBillingDatesInMonth(skipped, "2026-03")).toEqual(["2026-03-31"]);
  });

  it("derives annual and weekly plans on their own grids", () => {
    expect(projectedBillingDatesInMonth(annualSource, "2026-08")).toEqual(["2026-08-24"]);
    expect(projectedBillingDatesInMonth(annualSource, "2026-09")).toEqual([]);

    const weekly = ownerSource({
      intervalUnit: "week",
      intervalCount: 2,
      anchorDay: null,
      billingAnchor: "2026-08-03",
    });

    expect(projectedBillingDatesInMonth(weekly, "2026-08"))
      .toEqual(["2026-08-03", "2026-08-17", "2026-08-31"]);
  });

  it("prefers a real billing cycle over the derived recurrence", () => {
    const withCycle = ownerSource({
      cycles: [{ dueOn: "2026-08-18", status: "invoiced" }],
    });

    const month = buildSubscriptionCalendarMonth([withCycle], "2026-08", "owner");

    expect(Object.keys(month.entriesByDate)).toEqual(["2026-08-18"]);
    expect(month.entriesByDate["2026-08-18"]?.[0]).toMatchObject({
      origin: "cycle",
      cycleStatus: "invoiced",
    });
  });
});

describe("lifecycle exclusions", () => {
  it("drops a canceled subscription once it stops billing but keeps settled history", () => {
    const canceled = ownerSource({
      status: "canceled",
      canceledOn: "2026-07-20",
      cycles: [
        { dueOn: "2026-06-15", status: "paid" },
        { dueOn: "2026-08-15", status: "scheduled" },
      ],
    });

    expect(buildSubscriptionCalendarMonth([canceled], "2026-08", "owner").entriesByDate)
      .toEqual({});
    expect(
      Object.keys(buildSubscriptionCalendarMonth([canceled], "2026-06", "owner").entriesByDate),
    ).toEqual(["2026-06-15"]);
  });

  it("never renders voided or skipped cycles", () => {
    const voided = ownerSource({
      cycles: [
        { dueOn: "2026-08-15", status: "voided" },
        { dueOn: "2026-08-16", status: "skipped" },
      ],
    });

    /* No billable cycle remains for the month, so the derived recurrence is used. */
    expect(Object.keys(buildSubscriptionCalendarMonth([voided], "2026-08", "owner").entriesByDate))
      .toEqual(["2026-08-15"]);
    expect(
      buildSubscriptionCalendarMonth([voided], "2026-08", "owner")
        .entriesByDate["2026-08-15"]?.[0]?.origin,
    ).toBe("projected");
  });

  it("suppresses derived dates while a subscription is paused and resumes after", () => {
    const paused = ownerSource({
      status: "paused",
      pausedOn: "2026-07-01",
      resumesOn: "2026-10-01",
    });

    expect(buildSubscriptionCalendarMonth([paused], "2026-08", "owner").entriesByDate).toEqual({});
    expect(
      Object.keys(buildSubscriptionCalendarMonth([paused], "2026-10", "owner").entriesByDate),
    ).toEqual(["2026-10-15"]);
  });

  it("stops a pending cancellation after its effective date", () => {
    const ending = ownerSource({
      status: "pending_cancellation",
      cancelEffectiveOn: "2026-09-15",
    });

    expect(
      Object.keys(buildSubscriptionCalendarMonth([ending], "2026-09", "owner").entriesByDate),
    ).toEqual(["2026-09-15"]);
    expect(buildSubscriptionCalendarMonth([ending], "2026-10", "owner").entriesByDate).toEqual({});
  });
});

/* --------------------------------------------------------------- adapter */

const summary: SubscriptionSummary = {
  subscription_id: "sub-kraken",
  public_ref: "WFA1B2C3D4",
  company_id: "company-kraken",
  company_name: "Kraken Junk Removal",
  client_profile_id: null,
  service_id: "service-local-seo",
  service_name: "Local SEO",
  status: "active",
  health: "active",
  paid_cycle_count: 3,
  last_payment_at: "2026-07-15T10:00:00Z",
  next_payment_on: "2026-08-15",
  amount_cents: 49_900,
  currency: "USD",
  interval_unit: "month",
  interval_count: 1,
};

function detailFor(subscriptionId: string, items: { name: string; cents: number }[]) {
  return {
    subscription: {
      id: subscriptionId,
      billing_anchor: "2026-05-15",
      started_at: "2026-05-15T02:00:00Z",
      paused_at: null,
      resumes_at: null,
      cancel_effective_at: null,
      canceled_at: null,
    },
    current_plan: {
      interval_unit: "month",
      interval_count: 1,
      anchor_day: 15,
      end_of_month_policy: "clamp",
      currency: "USD",
    },
    plan_items: items.map((item, index) => ({
      service_name_snapshot: item.name,
      quantity: 1,
      unit_amount_cents: item.cents,
      unit_discount_cents: 0,
      position: index,
    })),
    cycles: [{ due_on: "2026-08-15", status: "scheduled" }],
    events: [],
  } as unknown as SubscriptionDetail;
}

function fakeRepository(rows: { summary: SubscriptionSummary; detail: SubscriptionDetail }[]) {
  return {
    list: async () => rows.map((row) => row.summary),
    getById: async (id: string) => {
      const match = rows.find((row) => row.summary.subscription_id === id);
      if (!match) throw new Error("subscription access is denied");
      return match.detail;
    },
  } as unknown as SubscriptionRepository;
}

describe("subscription calendar service authorization", () => {
  const kraken = { summary, detail: detailFor("sub-kraken", [{ name: "Local SEO", cents: 49_900 }]) };
  const blueKoiRow = {
    summary: {
      ...summary,
      subscription_id: "sub-blue-koi",
      company_id: "company-blue-koi",
      company_name: "Blue Koi Hauling",
      service_name: "Website Care",
      amount_cents: 14_900,
    },
    detail: detailFor("sub-blue-koi", [{ name: "Website Care", cents: 14_900 }]),
  };

  it("gives an Owner/Admin session every company the read model returned", async () => {
    const service = new SubscriptionCalendarService({
      repository: fakeRepository([kraken, blueKoiRow]),
    });

    const sources = await service.listSources("owner");

    expect(sources.map((source) => source.companyName))
      .toEqual(["Kraken Junk Removal", "Blue Koi Hauling"]);
  });

  it("never hands a client another company's subscription or any company identity", async () => {
    /*
     * A client session's RPC only ever returns its own company's rows, so the
     * fake repository models exactly that. The client perspective additionally
     * strips company identity before the payload leaves the server.
     */
    const service = new SubscriptionCalendarService({
      repository: fakeRepository([blueKoiRow]),
    });

    const sources = await service.listSources("client");

    expect(sources).toHaveLength(1);
    expect(sources[0]?.companyName).toBeNull();
    expect(sources[0]?.providerName).toBe("Wolf Forge");
    expect(JSON.stringify(sources)).not.toContain("Kraken");
    expect(JSON.stringify(sources)).not.toContain("Blue Koi");
  });

  it("aggregates multiple plan items into one subscription source", async () => {
    const service = new SubscriptionCalendarService({
      repository: fakeRepository([{
        summary,
        detail: detailFor("sub-kraken", [
          { name: "Local SEO", cents: 49_900 },
          { name: "Website Care", cents: 14_900 },
        ]),
      }]),
    });

    const sources = await service.listSources("owner");

    expect(sources[0]?.items).toHaveLength(2);
    expect(sources[0]?.amountCents).toBe(64_800);
  });
});

/* ------------------------------------------------------------- component */

describe("subscription calendar UI", () => {
  const ownerSources = [ownerSource(), blueKoi, annualSource];

  function renderOwner() {
    return render(
      <SubscriptionCalendarPanel
        perspective="owner"
        sources={ownerSources}
        loading={false}
        error={null}
        initialMonthKey="2026-08"
      />,
    );
  }

  it("locks the indicator colours: navy is monthly, gold is annual", () => {
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: /15 August 2026|August 15, 2026/i }));

    const css = readFileSync(
      resolve(sourceRoot, "components/subscriptions/subscription-calendar.module.css"),
      "utf8",
    );

    expect(css).toMatch(/\.dot\[data-cadence="monthly"\]\s*\{[^}]*var\(--wf-cal-navy\)/u);
    expect(css).toMatch(/\.dot\[data-cadence="annual"\]\s*\{[^}]*var\(--wf-cal-gold\)/u);
    expect(css).toMatch(/--wf-cal-navy:\s*#0b1d5c/u);
    expect(css).toMatch(/--wf-cal-gold:\s*#c79a22/u);
  });

  it("marks monthly days with monthly dots and annual days with annual dots", () => {
    const { container } = renderOwner();

    const monthlyDay = screen.getByRole("button", { name: /August 15, 2026, 2 subscriptions/i });
    const annualDay = screen.getByRole("button", { name: /August 24, 2026, 1 subscription/i });

    expect(monthlyDay.querySelectorAll('[data-cadence="monthly"]')).toHaveLength(2);
    expect(annualDay.querySelectorAll('[data-cadence="annual"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-cadence="annual"]').length).toBeGreaterThan(0);
  });

  it("returns the selected day's entries with company, service, amount and cadence", () => {
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: /August 15, 2026, 2 subscriptions/i }));

    const detail = screen.getByLabelText("Selected day subscriptions");
    expect(within(detail).getByText("Kraken Junk Removal")).toBeInTheDocument();
    expect(within(detail).getByText("Blue Koi Hauling")).toBeInTheDocument();
    expect(within(detail).getByText("Local SEO")).toBeInTheDocument();
    /* The line item and the subscription total both read $499.00. */
    expect(within(detail).getAllByText("$499.00").length).toBe(2);
    expect(within(detail).getAllByText("/ month").length).toBe(2);
    expect(within(detail).queryByText("Enterprise SEO Retainer")).not.toBeInTheDocument();
  });

  it("renders a minimal empty state for a day with no subscriptions", () => {
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: /August 12, 2026$/i }));

    expect(screen.getByText("No subscriptions on this date.")).toBeInTheDocument();
  });

  it("navigates months and reprojects the entries", () => {
    renderOwner();

    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    /* The annual plan does not bill in September, the monthly ones do. */
    expect(screen.getByRole("button", { name: /September 15, 2026, 2 subscriptions/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /September 24, 2026, 1 subscription/i }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();
  });

  it("describes the Owner/Admin footer as recurring revenue, never spend", () => {
    renderOwner();

    expect(screen.getByText("MONTHLY RECURRING REVENUE")).toBeInTheDocument();
    expect(screen.getByText("$648.00")).toBeInTheDocument();
    expect(screen.getByText("ANNUAL RECURRING REVENUE")).toBeInTheDocument();
    expect(screen.queryByText(/spend/i)).not.toBeInTheDocument();
  });

  /*
   * The client perspective is the same projection read from the payer's side.
   * These cover the scenarios that distinguish it: its own subscriptions only,
   * payment wording, and a footer that counts what is due rather than what is
   * new.
   */
  const clientMonthly = {
    ...ownerSource(),
    companyName: null,
    providerName: "Wolf Forge",
  };

  function renderClient(sources: SubscriptionCalendarSource[]) {
    return render(
      <SubscriptionCalendarPanel
        perspective="client"
        sources={sources}
        loading={false}
        error={null}
        initialMonthKey="2026-08"
      />,
    );
  }

  it("shows a client only their own monthly subscription, never another company", () => {
    renderClient([clientMonthly]);

    fireEvent.click(screen.getByRole("button", { name: /August 15, 2026, 1 payment/i }));

    expect(screen.getByText("My subscription calendar")).toBeInTheDocument();
    expect(screen.queryByText("Kraken Junk Removal")).not.toBeInTheDocument();
    expect(screen.queryByText("Blue Koi Hauling")).not.toBeInTheDocument();
    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/spend/i)).not.toBeInTheDocument();

    const detail = screen.getByLabelText("Selected day subscriptions");
    expect(within(detail).getByText("1 PAYMENT")).toBeInTheDocument();
    expect(within(detail).getAllByText("Local SEO").length).toBeGreaterThan(0);
    expect(within(detail).getByText("Wolf Forge")).toBeInTheDocument();
    expect(within(detail).getAllByText("$499.00").length).toBe(2);
    expect(within(detail).getAllByText("/ month").length).toBe(1);
  });

  it("shows an annual subscription on its own anniversary, with the annual indicator", () => {
    const clientAnnual = {
      ...annualSource,
      companyName: null,
      providerName: "Wolf Forge",
    };

    renderClient([clientAnnual]);

    const annualDay = screen.getByRole("button", { name: /August 24, 2026, 1 payment/i });
    expect(annualDay.querySelectorAll('[data-cadence="annual"]')).toHaveLength(1);

    fireEvent.click(annualDay);
    const detail = screen.getByLabelText("Selected day subscriptions");
    // The client card names the investment as its heading and as its line item.
    expect(within(detail).getAllByText("Enterprise SEO Retainer").length).toBe(2);
    // Scoped to the footer: the same amount also renders on the entry card.
    expect(screen.getByText("ANNUAL SUBSCRIPTION TOTAL").parentElement)
      .toHaveTextContent("$2,400.00");
  });

  it("lists every payment a client owes on one shared date", () => {
    const second = {
      ...ownerSource({
        subscriptionId: "sub-care",
        publicRef: "WFZ9Y8X7W6",
        items: [{ name: "Website Care", quantity: 1, netAmountCents: 14_900 }],
        amountCents: 14_900,
      }),
      companyName: null,
      providerName: "Wolf Forge",
    };

    renderClient([clientMonthly, second]);

    fireEvent.click(screen.getByRole("button", { name: /August 15, 2026, 2 payments/i }));

    const detail = screen.getByLabelText("Selected day subscriptions");
    expect(within(detail).getByText("2 PAYMENTS")).toBeInTheDocument();
    expect(within(detail).getAllByText("Local SEO").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("Website Care").length).toBeGreaterThan(0);
  });

  it("says nothing is due on a date with no payment", () => {
    renderClient([clientMonthly]);

    fireEvent.click(screen.getByRole("button", { name: /August 12, 2026$/i }));

    expect(screen.getByText("No subscription payments due on this date.")).toBeInTheDocument();
    expect(screen.queryByText("No subscriptions on this date.")).not.toBeInTheDocument();
  });

  it("navigates months and Today returns to the current month", () => {
    renderClient([clientMonthly]);

    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /September 15, 2026, 1 payment/i }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument();

    // Today leaves the pinned initial month for whatever month it is now.
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    const now = new Date();
    const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(now);
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
  });

  it("describes the client footer as subscription totals and counts what is due", () => {
    renderClient([clientMonthly]);

    expect(screen.getByText("MONTHLY SUBSCRIPTION TOTAL")).toBeInTheDocument();
    expect(screen.getByText("ANNUAL SUBSCRIPTION TOTAL")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE SUBSCRIPTIONS")).toBeInTheDocument();

    // The payer counts payments due this month, not subscriptions started.
    expect(screen.getByText("DUE THIS MONTH")).toBeInTheDocument();
    expect(screen.queryByText("NEW THIS MONTH")).not.toBeInTheDocument();
    expect(screen.queryByText("MONTHLY RECURRING REVENUE")).not.toBeInTheDocument();
  });

  it("keeps the count in the footer equal to the payments actually on the grid", () => {
    renderClient([clientMonthly]);

    const month = buildSubscriptionCalendarMonth([clientMonthly], "2026-08", "client");
    const onGrid = Object.values(month.entriesByDate).reduce(
      (total, entries) => total + entries.length,
      0,
    );

    expect(month.summary.monthEntryCount).toBe(onGrid);
    expect(screen.getByText("DUE THIS MONTH").parentElement).toHaveTextContent(String(onGrid));
  });
});
