import {
  dashboardTopServicesSchema,
  toComparison,
  type DashboardOverview,
  type DashboardQuery,
  type DashboardRange,
  type MetricComparison,
} from "../domain/dashboard/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserMutationClient } from "./types";

/**
 * The RPC returns raw current/previous pairs; percent change is derived here so
 * the zero-baseline rule lives in one place (`toComparison`) rather than being
 * re-expressed in SQL and again in the UI.
 */
type RawPair = { current: number; previous: number };

type RawOverview = Omit<
  DashboardOverview,
  "range" | "paid_orders" | "clients" | "new_subscriptions"
> & {
  paid_orders: RawPair;
  clients: { converted: RawPair; created: RawPair };
  new_subscriptions: RawPair;
};

function comparison(pair: RawPair | null | undefined): MetricComparison {
  return toComparison(Number(pair?.current ?? 0), Number(pair?.previous ?? 0));
}

export class DashboardRepository {
  constructor(private readonly client: UserMutationClient) {}

  async getWorkingSeoOrderCount(): Promise<number> {
    const result = await this.client.from("orders")
      .select("id,services!inner(service_folders!inner(name))", { count: "exact", head: true })
      .eq("status", "working")
      .is("archived_at", null)
      .in("services.service_folders.name", ["Local SEO", "GBP Only SEO"]);

    if (result.error) throw mapDatabaseError(result.error, "Working SEO orders");
    if (result.count === null) throw new Error("Working SEO order count is unavailable.");
    return result.count;
  }

  async getHistoryStart(currency: string): Promise<string | null> {
    const result = await this.client.rpc("app_dashboard_history_start", { p_currency: currency });
    if (result.error) throw mapDatabaseError(result.error, "Revenue history");
    if (result.data === null) return null;
    if (typeof result.data !== "string" || !Number.isFinite(Date.parse(result.data))) {
      throw new Error("Invalid revenue history date.");
    }
    return result.data;
  }

  async getTopServices(query: DashboardQuery) {
    const result = await this.client.rpc("app_dashboard_top_services", {
      p_start: query.start,
      p_end: query.end,
    });
    if (result.error) throw mapDatabaseError(result.error, "Top services");
    return dashboardTopServicesSchema.parse(result.data);
  }

  /**
   * One round trip and one MVCC snapshot for the whole screen. The RPC
   * re-authorizes against auth.uid() via app_require_module_access('dashboard'),
   * so this is a real boundary and not a convenience wrapper.
   */
  async getOverview(query: DashboardQuery, range: DashboardRange): Promise<DashboardOverview> {
    const result = await this.client.rpc("app_dashboard_overview", {
      p_start: query.start,
      p_end: query.end,
      p_previous_start: query.previous_start,
      p_previous_end: query.previous_end,
      p_bucket: query.bucket,
      p_time_zone: query.time_zone,
    });

    if (result.error) throw mapDatabaseError(result.error, "Dashboard");
    if (result.data == null) throw mapDatabaseError({ code: "PGRST116" }, "Dashboard");

    const raw = result.data as unknown as RawOverview;

    return {
      range,
      revenue: raw.revenue,
      paid_orders: comparison(raw.paid_orders),
      clients: {
        converted: comparison(raw.clients?.converted),
        created: comparison(raw.clients?.created),
      },
      new_subscriptions: comparison(raw.new_subscriptions),
      active_subscriptions: raw.active_subscriptions,
      sales_trend: raw.sales_trend,
      client_growth: raw.client_growth,
    };
  }
}
