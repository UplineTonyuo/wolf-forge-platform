import { describe, expect, it, vi } from "vitest";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { runProjectBatch } from "../domain/orders/bulk";
import { reportingServiceIds } from "../domain/reporting/service-profiles";
import { changeOrderStatusSchema } from "../domain/orders/schema";
import { OrderRepository } from "../repositories/order-repository";
import { orderReportRequirementSchema, reportSetupScopeSchema } from "../domain/reporting/order-completion";
import type { UserMutationClient } from "../repositories/types";

const scope = {
  orderId: "10000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000002",
  serviceId: reportingServiceIds.gmbManagement,
  serviceName: "GMB/GBP Management",
  reportingPeriodMonth: "2026-10-01",
  canRecordException: true,
};

describe("monthly report completion boundary", () => {
  it("accepts an unset work month in a requirement, but never in builder prefill", () => {
    expect(orderReportRequirementSchema.safeParse({ ...scope, reportingPeriodMonth: null }).success).toBe(true);
    expect(reportSetupScopeSchema.safeParse({ ...scope, reportingPeriodMonth: null }).success).toBe(false);
  });

  it("records and completes only the explicitly selected November scope", async () => {
    const rpc = vi.fn(async () => ({ data: { id: scope.orderId, status: "working" }, error: null }));
    const repository = new OrderRepository({ rpc } as unknown as UserMutationClient);
    const period = { serviceId: scope.serviceId, reportingPeriodMonth: "2026-11-01" };
    await repository.setReportingMonth(scope.orderId, period);
    await repository.completeForReportingMonth(scope.orderId, period);
    expect(rpc).toHaveBeenNthCalledWith(1, "app_set_order_reporting_month", { p_order_id: scope.orderId, p_service_id: scope.serviceId, p_reporting_period_month: "2026-11-01" });
    expect(rpc).toHaveBeenNthCalledWith(2, "app_complete_order_for_reporting_month", { p_order_id: scope.orderId, p_service_id: scope.serviceId, p_reporting_period_month: "2026-11-01" });
  });
  it("preserves the authoritative scope in each failed bulk outcome", async () => {
    const error = mapDatabaseError({ code: "WF431", details: JSON.stringify(scope) });
    const result = await runProjectBatch([scope.orderId], () => "GMB order", async () => { throw error; }, "Rejected");
    expect(result.succeeded).toEqual([]);
    expect(result.failed[0]).toMatchObject({ completionRequirement: scope, error: expect.stringMatching(/published report/i) });
  });

  it.each(["not json", JSON.stringify({ ...scope, reportingPeriodMonth: "2026-13-01" }), JSON.stringify({ ...scope, orderId: "spoofed" })])("never reflects malformed database details: %s", (details) => {
    expect(mapDatabaseError({ code: "WF431", details })).not.toHaveProperty("completionRequirement");
  });

  it.each(["", "   ", "\n\t", "a".repeat(1001)])("rejects an invalid exception reason", (reason) => {
    // The exception action/service must share this validation before calling SQL.
    expect(changeOrderStatusSchema.safeParse({ status: "complete", reportException: { ...scope, reason } }).success).toBe(false);
  });

  it("sends an exact-scoped exception to its atomic RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { id: scope.orderId, status: "complete" }, error: null }));
    const repository = new OrderRepository({ rpc } as unknown as UserMutationClient);
    await repository.completeWithoutReport(scope.orderId, { serviceId: scope.serviceId, reportingPeriodMonth: scope.reportingPeriodMonth, reason: "Client waived this month" });
    expect(rpc).toHaveBeenCalledWith("app_complete_order_without_report", {
      p_order_id: scope.orderId, p_service_id: scope.serviceId,
      p_reporting_period_month: "2026-10-01", p_reason: "Client waived this month",
    });
  });
});
