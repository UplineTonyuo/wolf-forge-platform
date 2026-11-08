import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), status: vi.fn(), module: vi.fn(), labels: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
const { completeProjectWithoutReportAction } = await import("../app/actions/orders");
const orderId = "10000000-0000-4000-8000-000000000001";
const input = { serviceId: "5f000000-0000-4000-8000-000000000318", reportingPeriodMonth: "2026-10-01", reason: "Client waived this month" };
const actor = { id: "10000000-0000-4000-8000-000000000002" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.labels.mockResolvedValue([]);
  mocks.context.mockResolvedValue({ actor, user: { projects: { edit: true } }, services: {
    permissions: { requireModuleAccess: mocks.module }, orders: { changeStatus: mocks.status, listLabels: mocks.labels },
  } });
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
