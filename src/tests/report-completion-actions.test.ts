import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), status: vi.fn(), module: vi.fn(), labels: vi.fn(), setMonth: vi.fn(), completeMonth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
const { completeProjectWithoutReportAction, completeProjectForReportingMonthAction } = await import("../app/actions/orders");
const orderId = "10000000-0000-4000-8000-000000000001";
const input = { serviceId: "5f000000-0000-4000-8000-000000000318", reportingPeriodMonth: "2026-10-01", reason: "Client waived this month" };
const actor = { id: "10000000-0000-4000-8000-000000000002" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.labels.mockResolvedValue([]);
  mocks.context.mockResolvedValue({ actor, user: { projects: { edit: true } }, services: {
    permissions: { requireModuleAccess: mocks.module }, orders: { changeStatus: mocks.status, listLabels: mocks.labels, setReportingMonth: mocks.setMonth, completeForReportingMonth: mocks.completeMonth },
  } });
});
it("persists an explicit November choice before attempting that exact completion", async () => {
  const period = { serviceId: input.serviceId, reportingPeriodMonth: "2026-11-01" };
  const result = await completeProjectForReportingMonthAction(orderId, period);
  expect(result.succeeded).toHaveLength(1);
  expect(mocks.setMonth).toHaveBeenCalledWith(orderId, period, actor);
  expect(mocks.completeMonth).toHaveBeenCalledWith(orderId, period, actor);
  expect(mocks.setMonth.mock.invocationCallOrder[0]).toBeLessThan(mocks.completeMonth.mock.invocationCallOrder[0]!);
});
it.each(["", "0000-11-01", "2026-11", "2026-13-01", "2026-11-02"])("refuses an invalid explicit month: %s", async (reportingPeriodMonth) => {
  expect((await completeProjectForReportingMonthAction(orderId, { serviceId: input.serviceId, reportingPeriodMonth })).succeeded).toEqual([]);
  expect(mocks.setMonth).not.toHaveBeenCalled();
  expect(mocks.completeMonth).not.toHaveBeenCalled();
});
it("cannot complete after month selection loses authority", async () => {
  mocks.setMonth.mockRejectedValue(new Error("denied"));
  expect((await completeProjectForReportingMonthAction(orderId, input)).succeeded).toEqual([]);
  expect(mocks.completeMonth).not.toHaveBeenCalled();
});
it("checks existing Project authority and passes only the exact validated exception", async () => {
  const result = await completeProjectWithoutReportAction(orderId, input);
  expect(result.succeeded).toHaveLength(1);
  expect(mocks.module).toHaveBeenCalledWith("projects");
  expect(mocks.status).toHaveBeenCalledWith(orderId, { status: "complete", reportException: input }, actor);
});
it.each(["", " \n\t ", "a".repeat(1001)])("rejects invalid reasons before mutation", async (reason) => {
  expect((await completeProjectWithoutReportAction(orderId, { ...input, reason })).succeeded).toEqual([]);
  expect(mocks.status).not.toHaveBeenCalled();
});
it("never treats browser capabilities as exception authority", async () => {
  mocks.context.mockResolvedValue({ actor, user: { projects: { edit: false } }, services: { permissions: { requireModuleAccess: mocks.module } } });
  expect((await completeProjectWithoutReportAction(orderId, input)).failed[0]?.error).toMatch(/permission/i);
  expect(mocks.status).not.toHaveBeenCalled();
});
