// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesTrendChart } from "../components/dashboard/sales-trend-chart";
import { TopServicesPanel } from "../components/dashboard/top-services-panel";
import { shiftRevenueWindow } from "../lib/dashboard/chart-window";
import { emptyRevenuePoints } from "../lib/dashboard/empty-revenue-points";
import { resolveDashboardRange } from "../lib/dashboard/date-range";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("period=this_month&servicesPeriod=year"),
}));
beforeEach(() => {
  push.mockReset();
  window.history.replaceState(null, "", "/dashboard?period=this_month&servicesPeriod=month");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Top services in-place periods", () => {
  it("switches preloaded results and preserves the sales window without route navigation", () => {
    render(<TopServicesPanel initialPeriod="month" periods={{
      week: { rangeLabel: "This week", content: <ol><li>SEO: 2 paid orders</li></ol> },
      month: { rangeLabel: "This month", content: <ol><li>SEO: 4 paid orders</li></ol> },
      year: { rangeLabel: "This year", content: <ol><li>Website: 9 paid orders</li></ol> },
    }} />);
    const panel = screen.getByRole("article");
    expect(within(panel).getByRole("list").textContent).toContain("SEO: 4");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("article")).toBe(panel);
    expect(within(panel).getByRole("list").textContent).toContain("SEO: 2");
    expect(window.location.search).toBe("?period=this_month&servicesPeriod=week");
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(within(panel).getByRole("list").textContent).toContain("Website: 9");
    expect(screen.getByRole("button", { name: "Year" }).getAttribute("aria-pressed")).toBe("true");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("revenue history windows", () => {
  it("keeps zero-revenue gaps navigable until the actual first movement", () => {
    const window = { from: "2026-10-23", to: "2026-10-24", today: "2026-10-24", earliest: "2026-10-20" };
    expect(shiftRevenueWindow(window, -1)).toEqual({ from: "2026-10-21", to: "2026-10-22" });
    expect(shiftRevenueWindow({ ...window, from: "2026-10-21", to: "2026-10-22" }, -1))
      .toEqual({ from: "2026-10-20", to: "2026-10-21" });
    expect(shiftRevenueWindow({ ...window, from: "2026-10-20", to: "2026-10-21" }, -1)).toBeNull();
    expect(shiftRevenueWindow({ ...window, earliest: null }, -1)).toBeNull();
  });
  it("fills a currency's empty range with the same business-local weekly buckets", () => {
    const range = resolveDashboardRange({ preset: "custom_range", from: "2026-01-01", to: "2026-03-31" });
    const points = emptyRevenuePoints(range);
    expect(points.length).toBeGreaterThan(10);
    expect(points[0]?.bucket_start).toBe("2025-12-28T16:00:00.000Z");
    expect(points.every((point) => point.net_cents === 0)).toBe(true);
  });
  it("moves a day across year boundaries", () => {
    expect(shiftRevenueWindow({ from: "2026-01-01", to: "2026-01-01", today: "2026-10-24" }, -1))
      .toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });
  it("preserves the visible duration across leap day", () => {
    expect(shiftRevenueWindow({ from: "2024-03-01", to: "2024-03-07", today: "2024-03-20" }, -1))
      .toEqual({ from: "2024-02-23", to: "2024-02-29" });
  });
  it("clamps the whole forward window to today", () => {
    expect(shiftRevenueWindow({ from: "2026-10-10", to: "2026-10-16", today: "2026-10-20" }, 1))
      .toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(shiftRevenueWindow({ from: "2026-10-14", to: "2026-10-20", today: "2026-10-20" }, 1)).toBeNull();
  });
  it("refuses invalid calendar dates and oversized windows", () => {
    expect(shiftRevenueWindow({ from: "2026-02-30", to: "2026-03-02", today: "2026-10-20" }, -1)).toBeNull();
    expect(shiftRevenueWindow({ from: "2024-01-01", to: "2026-01-01", today: "2026-10-20" }, -1)).toBeNull();
  });
});

describe("draggable sales trend", () => {
  const dates = { from: "2026-10-01", to: "2026-10-24", today: "2026-10-24" };
  const points = [{ value: 29600, label: "Oct 20, 2026", axisLabel: "Oct 20", money: "$296.00" }];
  function draggable() {
    vi.stubGlobal("PointerEvent", MouseEvent);
    render(<SalesTrendChart points={points} currency="USD" window={dates} />);
    const plot = screen.getByRole("group", { name: /Net revenue chart/ });
    Object.assign(plot, {
      setPointerCapture: vi.fn(), hasPointerCapture: () => false,
      getBoundingClientRect: () => ({ left: 0, width: 400 }),
    });
    return plot;
  }
  it("supports buttons even when the current period has no revenue", () => {
    render(<SalesTrendChart points={[]} currency="USD" window={dates} />);
    expect((screen.getByRole("button", { name: "Later dates" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Earlier dates" }));
    expect(push).toHaveBeenCalledWith("/dashboard?period=custom_range&servicesPeriod=year&from=2026-09-07&to=2026-09-30", { scroll: false });
    expect(screen.getByRole("group", { name: /Net revenue chart/ })).toBeTruthy();
    expect(screen.queryByText("Net revenue is zero for this period.")).toBeNull();
  });
  it("loads the earlier window after a horizontal drag", () => {
    const plot = draggable();
    fireEvent.pointerDown(plot, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(plot, { clientX: 200, clientY: 55 });
    fireEvent.pointerUp(plot, { clientX: 200, clientY: 55 });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("from=2026-09-07&to=2026-09-30"), { scroll: false });
  });
  it("does not turn a vertical phone scroll or cancelled drag into navigation", () => {
    const plot = draggable();
    fireEvent.pointerDown(plot, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerUp(plot, { clientX: 150, clientY: 200 });
    fireEvent.pointerDown(plot, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerCancel(plot);
    fireEvent.pointerUp(plot, { clientX: 250, clientY: 50 });
    expect(push).not.toHaveBeenCalled();
  });
  it("supports keyboard browsing with Page Up", () => {
    const plot = draggable();
    fireEvent.keyDown(plot, { key: "PageUp" });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("from=2026-09-07"), { scroll: false });
  });
});
