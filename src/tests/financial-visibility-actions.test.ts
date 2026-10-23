import { beforeEach, expect, it, vi } from "vitest";
import { invoiceFundingVisibility, invoiceVisibility, invoiceWorkVisibility, walletVisibility } from "../domain/invoices/visibility";
import { NotFoundError } from "../lib/errors/application-error";

const state = vi.hoisted(() => ({ enabled: true, membership: "active", balance: 1000, manage: true, status: "draft", targetDenied: false }));
const capabilities = () => ({ view: true, manage: state.manage, markPaid: false, refund: false, void: false });
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => {
  const context = () => ({
    user: { companyId: "company", invoices: capabilities() },
    services: {
      invoices: { list: async () => [], listForClient: async () => [], workEnabled: async () => state.enabled, get: async (id: string) => {
        if (state.targetDenied) throw new NotFoundError("Invoice");
        return { invoice: { id, status: state.status } };
      } },
      wallets: { getForCompany: async () => ({ balance_cents: state.balance, currency: "USD" }), listMyHistory: async () => [] },
      wfCard: { getMembership: async () => ({ status: state.membership }), storePurchaseProjectsEnabled: async () => true },
      permissions: { requireModuleAccess: async () => {} },
    },
  });
  return { getInternalContext: async () => context(), getClientContext: async () => context() };
});
const { loadFinancialVisibilityAction } = await import("../app/actions/financial-visibility");
beforeEach(() => { state.enabled = true; state.membership = "active"; state.balance = 1000; state.manage = true; state.status = "draft"; state.targetDenied = false; });
it("detects Invoice OFF on the wallet surface without a ledger or balance change", async () => {
  const before = await loadFinancialVisibilityAction("wallet");
  state.enabled = false;
  const after = await loadFinancialVisibilityAction("wallet");
  expect(after).toEqual({ ok: true, signature: walletVisibility({ balance_cents: 1000, currency: "USD" }, [], false, "active") });
  expect(after).not.toEqual(before);
});
it("detects revoked internal mutation authority while Invoice view and rows stay unchanged", async () => {
  const before = await loadFinancialVisibilityAction("internal");
  state.manage = false;
  const after = await loadFinancialVisibilityAction("internal");
  expect(after).toEqual({ ok: true, signature: invoiceVisibility([], true, capabilities()) });
  expect(after).not.toEqual(before);
});
it("detects a changed client funding offer on detail and dashboard without an Invoice change", async () => {
  const before = await loadFinancialVisibilityAction("client-detail");
  state.balance = 500; state.membership = "cancelled";
  const expected = { ok: true, signature: invoiceFundingVisibility([], true, { balance_cents: 500, currency: "USD" }, "cancelled") };
  expect(await loadFinancialVisibilityAction("client-detail")).toEqual(expected);
  expect(await loadFinancialVisibilityAction("dashboard")).toEqual(expected);
  expect(expected).not.toEqual(before);
});
it("refuses an unrecognized browser-supplied scope", async () => {
  expect(await loadFinancialVisibilityAction("foreign" as "client")).toEqual({ ok: false, denied: true });
});
it("checks form authority without reading unrelated Invoice rows", async () => {
  expect(await loadFinancialVisibilityAction("internal-work")).toEqual({ ok: true, signature: invoiceWorkVisibility(true, capabilities()) });
  state.manage = false;
  expect(await loadFinancialVisibilityAction("internal-work")).toEqual({ ok: true, signature: invoiceWorkVisibility(true, capabilities()) });
  state.enabled = false;
  expect(await loadFinancialVisibilityAction("internal-work")).toEqual({ ok: true, signature: invoiceWorkVisibility(false, capabilities()) });
});
it("invalidates an edited target that becomes paid or loses record visibility", async () => {
  const before = await loadFinancialVisibilityAction("internal-work", "target");
  state.status = "paid";
  expect(await loadFinancialVisibilityAction("internal-work", "target")).not.toEqual(before);
  state.targetDenied = true;
  expect(await loadFinancialVisibilityAction("internal-work", "target")).toEqual({ ok: false, denied: true });
});
