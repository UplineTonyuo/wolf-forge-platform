import {
  dashboardQuerySchema,
  type DashboardOverview,
  type DashboardRange,
} from "../domain/dashboard/schema";
import { parseInput } from "../domain/shared";
import { resolveDashboardRange, type ResolveRangeInput } from "../lib/dashboard/date-range";
import { DashboardRepository } from "../repositories/dashboard-repository";
import type { ServiceDependencies } from "./mutation-context";

/**
 * Read-only, so there is no actor assertion here — the same reasoning as every
 * other read path in the app. The database resolver is authoritative: this
 * service resolves the requested period into concrete instants and validates
 * their shape, and never decides who may see the numbers.
 */
export class DashboardService {
  constructor(private readonly dependencies: ServiceDependencies<DashboardRepository>) {}

  getHistoryStart(currency: string) { return this.dependencies.repository.getHistoryStart(currency); }

  async getTopServices(input: ResolveRangeInput) {
    const range = resolveDashboardRange(input);
    const query = parseInput(dashboardQuerySchema, {
      start: range.start, end: range.end,
      previous_start: range.previous.start, previous_end: range.previous.end,
      bucket: range.bucket, time_zone: range.timeZone,
    });
    return { range, services: await this.dependencies.repository.getTopServices(query) };
  }

  /**
   * Resolves a preset (or custom dates) and returns the whole dashboard.
   *
   * Async so that a bad range rejects the returned promise rather than throwing
   * synchronously past a caller's `.catch()`; range resolution and validation
   * both run inside it.
   */
  async getOverview(input: ResolveRangeInput, now?: Date): Promise<DashboardOverview> {
    return this.getOverviewForRange(resolveDashboardRange(input, now));
  }

  async getOverviewForRange(range: DashboardRange): Promise<DashboardOverview> {
    const query = parseInput(dashboardQuerySchema, {
      start: range.start,
      end: range.end,
      previous_start: range.previous.start,
      previous_end: range.previous.end,
      bucket: range.bucket,
      time_zone: range.timeZone,
    });

    return this.dependencies.repository.getOverview(query, range);
  }
}
