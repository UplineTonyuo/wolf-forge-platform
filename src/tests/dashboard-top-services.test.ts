import { describe, expect, it, vi } from "vitest";
import { DashboardRepository } from "../repositories/dashboard-repository";
import { dashboardTopServicesSchema } from "../domain/dashboard/schema";
import { resolveDashboardRange } from "../lib/dashboard/date-range";
import { yearToDateRange } from "../lib/dashboard/reporting-presets";

const query = {
  start: "2026-10-01T00:00:00Z", end: "2026-10-25T00:00:00Z",
  previous_start: "2026-09-01T00:00:00Z", previous_end: "2026-09-25T00:00:00Z",
  bucket: "day" as const, time_zone: "Asia/Manila",
};

describe("top services read model", () => {
  it("keeps server ranking and converts an integer count from the wire", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      service_id: "10000000-0000-4000-8000-000000000001", name: "SEO", paid_orders: "4",
    }], error: null });
    const ranked = await new DashboardRepository({ rpc } as never).getTopServices(query);
    expect(ranked[0]).toEqual({ service_id: "10000000-0000-4000-8000-000000000001", name: "SEO", paid_orders: 4 });
    expect(rpc).toHaveBeenCalledWith("app_dashboard_top_services", { p_start: query.start, p_end: query.end });
  });

  it("distinguishes an empty ranking from missing or failed data", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Denied" } });
    const repository = new DashboardRepository({ rpc } as never);
    await expect(repository.getTopServices(query)).resolves.toEqual([]);
    await expect(repository.getTopServices(query)).rejects.toThrow();
    await expect(repository.getTopServices(query)).rejects.toThrow();
  });

  it("rejects negative, fractional and oversized rankings", () => {
    const row = { service_id: null, name: "Historical service", paid_orders: 2 };
    expect(dashboardTopServicesSchema.safeParse([{ ...row, paid_orders: -1 }]).success).toBe(false);
    expect(dashboardTopServicesSchema.safeParse([{ ...row, paid_orders: 1.5 }]).success).toBe(false);
    expect(dashboardTopServicesSchema.safeParse(Array(6).fill(row)).success).toBe(false);
  });

  it("uses a complete business year-to-date window including leap day", () => {
    const range = resolveDashboardRange({ preset: "custom_range", ...yearToDateRange("2024-12-31") });
    expect(range.start).toBe("2023-12-31T16:00:00.000Z");
    expect(range.end).toBe("2024-12-31T16:00:00.000Z");
    expect((Date.parse(range.end) - Date.parse(range.start)) / 86400000).toBe(366);
  });
});
