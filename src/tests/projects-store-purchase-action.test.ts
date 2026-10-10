import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ purchase: vi.fn(), gate: vi.fn(), event: vi.fn(), projectVisible: true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/security/request-correlation", () => ({ currentCorrelationId: async () => "test" }));
vi.mock("../lib/security/security-log", () => ({ recordSecurityEvent: mocks.event }));
vi.mock("../lib/security/observed-failure", () => ({ observeActionFailure: async () => ({ message: "Unavailable" }) }));
vi.mock("../lib/supabase/next-server", () => ({ getClientContext: async () => ({
  actor: { id: "client" }, user: { modules: { portal_projects: mocks.projectVisible } },
  services: { permissions: { requireModuleAccess: mocks.gate }, wfCard: { purchaseServiceWithBalance: mocks.purchase } },
}) }));
const { purchaseServiceWithBalanceAction } = await import("../app/actions/store-purchase");
const input = { serviceId: "service", requestId: "request" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.projectVisible = true;
  mocks.purchase.mockResolvedValue({ orderId: "order", invoiceId: "invoice", orderNumber: 1, amountCents: 1000, currency: "USD", walletBalanceCents: 99000, serviceName: "Synthetic service", replayed: false });
});
describe("Store Projects boundary", () => {
  it("retains the Store gate and leaves purchase/replay decisions to the authoritative RPC", async () => {
    expect(await purchaseServiceWithBalanceAction(input)).toMatchObject({ ok: true, destinationHref: "/account/projects" });
    expect(mocks.gate.mock.calls).toEqual([["portal_store"]]);
    expect(mocks.purchase).toHaveBeenCalledWith({ request_id: "request", service_id: "service" }, { id: "client" });
  });
  it("routes accepted retries to the financial receipt without a Projects precheck", async () => {
    mocks.purchase.mockResolvedValue({ invoiceId: "invoice", replayed: true });
    expect(await purchaseServiceWithBalanceAction(input)).toMatchObject({ ok: true, replayed: true, destinationHref: "/account/invoices/invoice" });
    expect(mocks.gate.mock.calls).toEqual([["portal_store"]]);
  });
  it("preserves authorized purchases without Project viewing and opens the receipt", async () => {
    mocks.projectVisible = false;
    expect(await purchaseServiceWithBalanceAction(input)).toMatchObject({ ok: true, destinationHref: "/account/invoices/invoice" });
  });
  it("reports a disabled-module refusal as an expected denial without success", async () => {
    mocks.purchase.mockRejectedValueOnce(new Error("WF_PROJECTS_DISABLED"));
    expect(await purchaseServiceWithBalanceAction(input)).toEqual({ ok: false, code: "PROJECTS_DISABLED", error: "New service purchases are unavailable while Projects is disabled." });
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ event: "economic.purchase.denied", outcome: "denied", metadata: { action: "store.purchase", reason: "projects_disabled" } }));
  });
});
