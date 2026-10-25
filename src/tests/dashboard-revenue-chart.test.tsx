// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesTrendChart } from "../components/dashboard/sales-trend-chart";
import { revenuePlot, revenueTickIndexes } from "../lib/dashboard/revenue-plot";
import { reportingButtonLabel } from "../lib/dashboard/reporting-presets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

afterEach(cleanup);

describe("revenue plot", () => {
  it("places zero on its true baseline and losses below it", () => {
    const plot = revenuePlot([-10000, 0, 10000]);
    expect(plot.zeroY).toBe(50);
    expect(plot.points.map((point) => point.y)).toEqual([100, 50, 0]);
    expect(plot.ticks.some((tick) => tick.value < 0)).toBe(true);
    expect(plot.area).toMatch(/L 100 50 L 0 50 Z$/);
  });

  it("keeps every all-negative value below the zero line", () => {
    const plot = revenuePlot([-20000, -1000]);
    expect(plot.zeroY).toBe(0);
    expect(plot.points.every((point) => point.y > plot.zeroY)).toBe(true);
  });

  it("does not invent activity for zero or empty series", () => {
    expect(revenuePlot([0, 0, 0]).hasActivity).toBe(false);
    expect(revenuePlot([]).hasActivity).toBe(false);
    expect(revenuePlot([]).line).toBe("");
  });

  it("centers a single point and rejects non-finite money", () => {
    expect(revenuePlot([29600]).points[0]?.x).toBe(50);
    expect(() => revenuePlot([NaN])).toThrow();
    expect(() => revenuePlot([Infinity])).toThrow();
  });

  it("limits date ticks without losing either end of an annual series", () => {
    const ticks = revenueTickIndexes(53);
    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(52);
    expect(revenueTickIndexes(1)).toEqual([0]);
    expect(revenueTickIndexes(0)).toEqual([]);
  });

  it("labels a rolling 30-day selection separately from this month", () => {
    expect(reportingButtonLabel({ preset: "last_30_days" })).toBe("30 days");
    expect(reportingButtonLabel({ preset: "this_month" })).toBe("This month");
  });
});

describe("sales trend accessibility", () => {
  const points = [
    { value: 12000, label: "Oct 20, 2026", axisLabel: "Oct 20", money: "$120.00" },
    { value: -5000, label: "Oct 21, 2026", axisLabel: "Oct 21", money: "-$50.00" },
    { value: 0, label: "Oct 22, 2026", axisLabel: "Oct 22", money: "$0.00" },
  ];

  it("lets keyboard users inspect negative and zero values", () => {
    render(<SalesTrendChart points={points} currency="USD" />);
    const chart = screen.getByRole("group", { name: /Net revenue chart/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("status").textContent).toContain("-$50.00");
    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByRole("status").textContent).toContain("$0.00");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status").textContent).toContain("$120.00");
  });

  it("offers a visible data-table disclosure with the actual currency", () => {
    render(<SalesTrendChart points={points} currency="USD" />);
    expect(screen.getByText("View revenue data")).toBeTruthy();
    expect(screen.getByText("Net collected revenue in USD")).toBeTruthy();
  });

  it("keeps a flat chart available when the selected period has no revenue", () => {
    render(<SalesTrendChart points={[]} currency="USD" />);
    expect(screen.queryByText("Net revenue is zero for this period.")).toBeNull();
    expect(screen.getByRole("group", { name: /Net revenue chart/ })).toBeTruthy();
  });
});
