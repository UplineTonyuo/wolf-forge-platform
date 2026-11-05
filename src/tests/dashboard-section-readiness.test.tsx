import { setImmediate } from "node:timers/promises";
import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveDashboardRange } from "../lib/dashboard/date-range";
import { toComparison } from "../domain/dashboard/schema";
import DashboardPage from "../app/(internal)/dashboard/page";

const mocks = vi.hoisted(() => ({ context: vi.fn(), overview: vi.fn(), history: vi.fn(), top: vi.fn(), catalog: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
vi.mock("../components/dashboard/dashboard-reporting-control", () => ({ DashboardReportingControl: () => null }));
vi.mock("../components/dashboard/sales-trend-chart", () => ({ SalesTrendChart: () => null }));

function find(node: ReactNode, match: (element: ReactElement<{ children?: ReactNode }>) => boolean): ReactElement<{ children?: ReactNode }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (match(child)) return child;
    const nested = find(child.props.children, match);
    if (nested) return nested;
  }
}

const range = resolveDashboardRange({ preset: "this_month" }, new Date("2026-11-06T00:00:00Z"));
const overview = {
  range, revenue: { headline_currency: "GBP", current: [{ currency: "GBP", net_cents: 900, refunds_cents: 0 }, { currency: "USD", net_cents: 400 }], previous: [] },
  clients: { converted: toComparison(2, 1), created: toComparison(3, 0) },
  paid_orders: toComparison(4, 1), new_subscriptions: toComparison(1, 0),
  active_subscriptions: { billable: 2, by_status: [] }, sales_trend: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { greetingName: "Synthetic", modules: { services: true, subscriptions: true } }, services: {
    dashboard: { getOverview: mocks.overview, getHistoryStart: mocks.history, getTopServices: mocks.top }, catalog: { listCatalog: mocks.catalog },
  } });
  mocks.overview.mockResolvedValue(overview);
  mocks.history.mockResolvedValue(null);
  mocks.top.mockResolvedValue({ range, services: [] });
  mocks.catalog.mockResolvedValue([]);
});

it.each(["ranking", "catalog"])("returns ready Dashboard content while %s remains pending", async (slow) => {
  let finish!: (value: never) => void;
  const delayed = new Promise((resolve) => { finish = resolve; });
  if (slow === "ranking") mocks.top.mockReturnValueOnce(delayed);
  else mocks.catalog.mockReturnValue(delayed);
  let ready = false;
  const pending = DashboardPage({ searchParams: Promise.resolve({ servicesPeriod: "year", period: "last_7_days" }) }).then((page) => { ready = true; return page; });
  try {
    await setImmediate();
    expect(mocks.top).toHaveBeenCalledTimes(3);
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith("GBP");
    expect(ready).toBe(true);
    const page = await pending;
    expect(find(page, (element) => element.type === "section" && element.props["aria-label" as keyof typeof element.props] === "Executive metrics")).toBeTruthy();
    expect(find(page, (element) => element.type === Suspense)).toBeTruthy();
    expect(mocks.overview).toHaveBeenCalledExactlyOnceWith({ preset: "last_7_days", date: undefined, from: undefined, to: undefined });
  } finally {
    finish((slow === "ranking" ? { range, services: [] } : []) as never);
    await pending;
  }
});

it("starts no personalized reads until the verified context resolves", async () => {
  let finish!: (value: unknown) => void;
  const context = await mocks.context();
  mocks.context.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = DashboardPage({ searchParams: Promise.resolve({}) });
  await setImmediate();
  expect(mocks.top).not.toHaveBeenCalled();
  expect(mocks.overview).not.toHaveBeenCalled();
  expect(mocks.catalog).not.toHaveBeenCalled();
  finish(context);
  await pending;
});

it("does not read the catalog without its own grant and keeps overview errors", async () => {
  const context = await mocks.context();
  context.user.modules.services = false;
  mocks.overview.mockRejectedValue(new Error("Synthetic overview failure"));
  const page = await DashboardPage({ searchParams: Promise.resolve({}) });
  expect(mocks.catalog).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
  expect(find(page, (element) => Boolean((element.props as { message?: string }).message))).toBeTruthy();
});

it("keeps all three periods, individual ranking errors and catalog fallback after streaming", async () => {
  mocks.top.mockRejectedValueOnce(new Error("Synthetic week failure"))
    .mockResolvedValueOnce({ range, services: [{ service_id: "service-a", name: "Synthetic monthly service", paid_orders: 3 }] });
  mocks.catalog.mockRejectedValue(new Error("Synthetic catalog failure"));
  const page = await DashboardPage({ searchParams: Promise.resolve({ servicesPeriod: "year" }) });
  const boundary = find(page, (element) => element.type === Suspense)!;
  const section = Children.only(boundary.props.children) as ReactElement<Record<string, unknown>>;
  const panel = await (section.type as (props: typeof section.props) => Promise<ReactElement<{ initialPeriod: string; periods: Record<"week" | "month" | "year", { content: ReactNode }> }>>)(section.props);
  expect(panel.props.initialPeriod).toBe("year");
  expect(Object.keys(panel.props.periods)).toEqual(["week", "month", "year"]);
  const { renderToStaticMarkup } = await import("react-dom/server");
  expect(renderToStaticMarkup(panel.props.periods.week.content)).toContain("Try refreshing");
  expect(renderToStaticMarkup(panel.props.periods.month.content)).toContain("Synthetic monthly service");
  expect(renderToStaticMarkup(panel.props.periods.year.content)).toContain("No paid orders");
  expect(mocks.top).toHaveBeenCalledTimes(3);
  expect(mocks.catalog).toHaveBeenCalledTimes(1);
});
