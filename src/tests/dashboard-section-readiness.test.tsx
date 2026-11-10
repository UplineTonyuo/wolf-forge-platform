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

function chartBoundary(page: ReactNode) {
  return find(page, (element) => element.type === Suspense &&
    (element.props as { fallback?: ReactElement<{ "aria-label"?: string }> }).fallback?.props["aria-label"] === "Loading sales trend")!;
}

async function resolveChild(boundary: ReactElement<{ children?: ReactNode }>) {
  const child = Children.only(boundary.props.children) as ReactElement<Record<string, unknown>>;
  return (child.type as (props: typeof child.props) => Promise<ReactElement>)(child.props);
}

it("returns overview cards before history and preserves the exact currency and earliest date after streaming", async () => {
  let finish!: (value: string) => void;
  mocks.history.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  let ready = false;
  const pending = DashboardPage({ searchParams: Promise.resolve({}) }).then((page) => { ready = true; return page; });
  let chart: Promise<ReactElement> | undefined;
  try {
    await setImmediate();
    expect(ready).toBe(true);
    const page = await pending;
    expect(find(page, (element) => element.props["aria-label" as keyof typeof element.props] === "Executive metrics")).toBeTruthy();
    const boundary = chartBoundary(page);
    expect(boundary).toBeTruthy();
    chart = resolveChild(boundary);
    await setImmediate();
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith("GBP");
    finish("2026-01-01T20:00:00Z");
    const resolved = await chart;
    const props = resolved.props as { currency: string; window: { earliest: string; from: string; to: string }; points: unknown[] };
    expect(props.currency).toBe("GBP");
    expect(props.window.earliest).toBe("2026-01-02");
    expect(props.window.from).toBe("2026-11-01");
    expect(props.window.to).toBe("2026-11-06");
    expect(props.points.length).toBeGreaterThan(0);
    expect(resolved.key).toBe(`${range.start}:${range.end}`);
  } finally {
    finish("2026-01-01T20:00:00Z");
    await pending;
    await chart;
  }
});

it("keeps an empty history bound null and exposes a labeled busy chart fallback", async () => {
  const page = await DashboardPage({ searchParams: Promise.resolve({}) });
  const boundary = chartBoundary(page);
  const fallback = (boundary.props as { fallback: ReactElement }).fallback;
  const { renderToStaticMarkup } = await import("react-dom/server");
  expect(renderToStaticMarkup(fallback)).toContain('role="status" aria-busy="true"');
  const chart = await resolveChild(boundary);
  expect((chart.props as { window: { earliest: string | null } }).window.earliest).toBeNull();
});

it("contains failed history in the chart panel while retaining overview cards", async () => {
  mocks.history.mockRejectedValue(new Error("Synthetic private history detail"));
  const page = await DashboardPage({ searchParams: Promise.resolve({}) });
  const boundary = chartBoundary(page);
  expect(boundary).toBeTruthy();
  expect(find(page, (element) => element.props["aria-label" as keyof typeof element.props] === "Executive metrics")).toBeTruthy();
  const error = await resolveChild(boundary);
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(error);
  expect(html).toContain("role=\"alert\"");
  expect(html).not.toContain("Synthetic private history detail");
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { greetingName: "Synthetic", modules: { services: true, subscriptions: true } }, services: {
    dashboard: { getOverview: mocks.overview, getHistoryStart: mocks.history, getTopServices: mocks.top }, catalog: { listCatalogOptions: mocks.catalog },
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
    expect(mocks.history).not.toHaveBeenCalled();
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
  const boundary = find(page, (element) => element.type === Suspense &&
    (element.props as { fallback?: ReactElement<{ "aria-label"?: string }> }).fallback?.props["aria-label"] !== "Loading sales trend")!;
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
