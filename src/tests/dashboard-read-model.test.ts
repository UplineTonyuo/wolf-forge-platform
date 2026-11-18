import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { toComparison } from "../domain/dashboard/schema";
import { resolveDashboardRange } from "../lib/dashboard/date-range";
import { DashboardRepository } from "../repositories/dashboard-repository";
import { DashboardService } from "../services/dashboard-service";

it("counts only non-archived Working orders in the Local SEO and GBP service folders", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(null, { headers: { "content-range": "0-0/1" } }),
  );
  const client = createClient("https://qa.example.test", "test-key", {
    auth: { persistSession: false },
    global: { fetch },
  });
  const repository = new DashboardRepository(client as never);

  await expect(repository.getWorkingSeoOrderCount()).resolves.toBe(1);
  const [requestUrl, options] = fetch.mock.calls[0]!;
  const url = new URL(String(requestUrl));
  expect(url.pathname).toBe("/rest/v1/orders");
  expect(options?.method).toBe("HEAD");
  expect(new Headers(options?.headers).get("Prefer")).toBe("count=exact");
  expect(url.searchParams.get("select")).toBe("id,services!inner(service_folders!inner(name))");
  expect(url.searchParams.get("status")).toBe("eq.working");
  expect(url.searchParams.get("archived_at")).toBe("is.null");
  expect(url.searchParams.get("services.service_folders.name")).toBe("in.(Local SEO,GBP Only SEO)");
});

/**
 * The payload shape below is the one app_dashboard_overview actually returns;
 * every field is asserted against real fixtures in
 * supabase/tests/database/025_dashboard_executive_metrics.test.sql. This suite
 * covers the half the database cannot: that the jsonb maps onto the TypeScript
 * contract and that comparisons are derived, not trusted from the wire.
 */
const payload = {
  revenue: {
    headline_currency: "USD",
    current: [
      { currency: "GBP", gross_cents: 7000, refunds_cents: 0, net_cents: 7000 },
      { currency: "USD", gross_cents: 12000, refunds_cents: 1500, net_cents: 10500 },
    ],
    previous: [{ currency: "USD", gross_cents: 3000, refunds_cents: 0, net_cents: 3000 }],
  },
  paid_orders: { current: 3, previous: 1 },
  clients: {
    converted: { current: 2, previous: 1 },
    created: { current: 2, previous: 0 },
  },
  new_subscriptions: { current: 2, previous: 1 },
  active_subscriptions: {
    billable: 3,
    by_status: [
      { status: "active", count: 1 },
      { status: "past_due", count: 1 },
      { status: "paused", count: 1 },
      { status: "pending_cancellation", count: 1 },
    ],
  },
  sales_trend: [
    {
      currency: "USD",
      points: [
        { bucket_start: "2026-06-10T00:00:00+08:00", net_cents: 0 },
        { bucket_start: "2026-06-11T00:00:00+08:00", net_cents: 4000 },
        { bucket_start: "2026-06-15T00:00:00+08:00", net_cents: -1500 },
      ],
    },
  ],
  client_growth: {
    supported: true,
    tracking_since: "2026-06-11T01:00:00.000Z",
    points: [
      { bucket_start: "2026-06-11T00:00:00+08:00", to_contact: 0, to_lead: 0, to_client: 1, to_client_team: 0 },
    ],
  },
};

function repositoryReturning(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { repository: new DashboardRepository({ rpc } as never), rpc };
}

const range = resolveDashboardRange({ preset: "last_7_days" }, new Date("2026-06-17T02:00:00.000Z"));

describe("dashboard read model", () => {
  it("maps the aggregate payload onto the dashboard contract", async () => {
    const { repository } = repositoryReturning(payload);
    const overview = await new DashboardService({ repository }).getOverviewForRange(range);

    expect(overview.revenue.headline_currency).toBe("USD");
    expect(overview.revenue.current).toHaveLength(2);
    expect(overview.revenue.current.find((entry) => entry.currency === "USD")?.net_cents).toBe(10500);
    expect(overview.active_subscriptions.billable).toBe(3);
    expect(overview.sales_trend[0]?.points).toHaveLength(3);
    expect(overview.client_growth.supported).toBe(true);
    expect(overview.range).toBe(range);
  });

  it("derives comparisons rather than trusting them from the wire", async () => {
    const { repository } = repositoryReturning(payload);
    const overview = await new DashboardService({ repository }).getOverviewForRange(range);

    expect(overview.paid_orders).toEqual({
      current: 3, previous: 1, delta: 2, percent_change: 200,
    });
    expect(overview.clients.converted.delta).toBe(1);
    expect(overview.new_subscriptions.percent_change).toBe(100);
  });

  it("reports no percent change against a zero baseline", () => {
    // The UI renders "—" for this; a fabricated 100% would imply a real trend.
    expect(toComparison(5, 0).percent_change).toBeNull();
    expect(toComparison(0, 0).percent_change).toBeNull();
    expect(toComparison(0, 4)).toEqual({
      current: 0, previous: 4, delta: -4, percent_change: -100,
    });
  });

  it("passes the resolved window and timezone through to the RPC", async () => {
    const { repository, rpc } = repositoryReturning(payload);
    await new DashboardService({ repository }).getOverviewForRange(range);

    expect(rpc).toHaveBeenCalledWith("app_dashboard_overview", {
      p_start: range.start,
      p_end: range.end,
      p_previous_start: range.previous.start,
      p_previous_end: range.previous.end,
      p_bucket: "day",
      p_time_zone: "Asia/Manila",
    });
  });

  it("survives a window in which nothing happened", async () => {
    const { repository } = repositoryReturning({
      ...payload,
      revenue: { headline_currency: "USD", current: [], previous: [] },
      paid_orders: { current: 0, previous: 0 },
      sales_trend: [],
      client_growth: { supported: false, tracking_since: null, points: [] },
    });
    const overview = await new DashboardService({ repository }).getOverviewForRange(range);

    expect(overview.revenue.current).toEqual([]);
    expect(overview.paid_orders.percent_change).toBeNull();
    expect(overview.client_growth.supported).toBe(false);
  });

  it("refuses a range longer than the scan limit before it reaches the database", async () => {
    const { repository, rpc } = repositoryReturning(payload);
    const tooLong = {
      ...range,
      start: "2020-01-01T00:00:00.000Z",
      end: "2026-01-01T00:00:00.000Z",
    };

    await expect(
      new DashboardService({ repository }).getOverviewForRange(tooLong),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed preset rather than throwing past a caller's catch", async () => {
    const { repository, rpc } = repositoryReturning(payload);
    const service = new DashboardService({ repository });

    // A synchronous throw here would slip past .catch() on the returned promise.
    await expect(service.getOverview({ preset: "custom_range", from: "2026-08-01" })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a database refusal instead of returning empty metrics", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const repository = new DashboardRepository({ rpc } as never);

    await expect(
      new DashboardService({ repository }).getOverviewForRange(range),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
