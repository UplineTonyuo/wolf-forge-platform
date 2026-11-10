import { beforeEach, expect, it, vi } from "vitest";
import { reportingServiceIds } from "../domain/reporting/service-profiles";

const mocks = vi.hoisted(() => ({ context: vi.fn(), options: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
const { listReportServiceChoicesAction } = await import("../app/actions/reporting");
const companyId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.context.mockResolvedValue({ services: { reporting: { listServiceOptions: mocks.options } } });
});

it("retains owned order-only services alongside subscribed services", async () => {
  mocks.options.mockResolvedValue([
    { service_id: reportingServiceIds.gmbManagement, service_name: "Renamed GMB", subscription_id: null, subscription_status: null },
    { service_id: reportingServiceIds.starterSeo, service_name: "Renamed SEO", subscription_id: companyId, subscription_status: "active" },
  ]);
  const result = await listReportServiceChoicesAction({ companyId });
  expect(result).toMatchObject({ ok: true, choices: [
    { serviceId: reportingServiceIds.gmbManagement, subscriptionId: null },
    { serviceId: reportingServiceIds.starterSeo, subscriptionId: companyId },
  ] });
  expect(result).not.toHaveProperty("fallback");
});

it("keeps an empty authoritative ownership result empty", async () => {
  mocks.options.mockResolvedValue([]);
  expect(await listReportServiceChoicesAction({ companyId })).toEqual({ ok: true, choices: [] });
});
