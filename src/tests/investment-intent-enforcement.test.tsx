/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import { navigationForModules } from "../components/shell/nav-registry";
import { ApplicationError } from "../lib/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireModuleAccess: vi.fn(), list: vi.fn(), setStatus: vi.fn(), record: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({ actor: {}, user: { investmentIntent: { manage: true } }, services: {
    permissions: { requireModuleAccess: mocks.requireModuleAccess },
    investmentIntent: { list: mocks.list, setStatus: mocks.setStatus },
  } }),
  getClientContext: async () => ({ actor: {}, services: { storeInterest: { record: mocks.record } } }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { updateInvestmentIntentStatusAction, recordStoreInterestAction } = await import("../app/actions/store-interest");
const { default: InvestmentIntentPage } = await import("../app/(internal)/investment-intent/page");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModuleAccess.mockResolvedValue(true);
  mocks.list.mockResolvedValue([]);
  mocks.setStatus.mockResolvedValue(undefined);
  mocks.record.mockResolvedValue(undefined);
});

it("refuses a typed Intent route before loading business data", async () => {
  mocks.requireModuleAccess.mockRejectedValue(new ApplicationError("PERMISSION_DENIED", "Denied"));
  await expect(InvestmentIntentPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/");
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.requireModuleAccess).toHaveBeenCalledWith("investment_intent");
});

it("removes only Intent from navigation when its authoritative grant is false", () => {
  const entries = navigationForModules({ investment_intent: false, services: true, tickets: true, reporting: true });
  expect(entries.flatMap((section) => section.items.map((item) => item.id))).toEqual(["tickets", "reporting", "services"]);
});

it("management action preflights before any mutation", async () => {
  mocks.requireModuleAccess.mockRejectedValue(new ApplicationError("PERMISSION_DENIED", "Denied"));
  expect(await updateInvestmentIntentStatusAction({ intentId: "fixture", status: "qualified" })).toMatchObject({ ok: false });
  expect(mocks.setStatus).not.toHaveBeenCalled();
});

it("authorized management keeps the existing actor and mutation flow", async () => {
  expect(await updateInvestmentIntentStatusAction({ intentId: "fixture", status: "qualified" })).toEqual({ ok: true });
  expect(mocks.setStatus).toHaveBeenCalledWith({ intentId: "fixture", status: "qualified" }, {});
  expect(mocks.requireModuleAccess.mock.invocationCallOrder[0]).toBeLessThan(mocks.setStatus.mock.invocationCallOrder[0]!);
});

it("refused client telemetry remains a best-effort false result", async () => {
  mocks.record.mockRejectedValue(new ApplicationError("PERMISSION_DENIED", "Denied"));
  expect(await recordStoreInterestAction({ serviceIds: ["fixture"], inCart: true })).toEqual({ ok: false });
});
