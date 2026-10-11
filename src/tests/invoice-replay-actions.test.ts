import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError, ValidationError } from "../lib/errors/application-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), payment: vi.fn(), refund: vi.fn(), markPaid: true, canRefund: true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({
  actor: { id: "actor" },
  user: { invoices: { markPaid: mocks.markPaid, refund: mocks.canRefund } },
  services: { invoices: { get: mocks.get, recordPayment: mocks.payment, refund: mocks.refund } },
}) }));
import { recordInvoicePaymentAction, refundInvoiceAction } from "../app/actions/invoices";
const requestId = "20000000-0000-4000-8000-000000008389";
beforeEach(() => {
  vi.clearAllMocks(); mocks.markPaid = true; mocks.canRefund = true;
  mocks.get.mockResolvedValue({ financials: { balance_due_cents: 0, gross_paid_cents: 1000, successful_refunds_cents: 1000 } });
  mocks.payment.mockResolvedValue({ id: "original-payment" });
  mocks.refund.mockResolvedValue({ id: "original-refund" });
});
it("lets the database answer an exact accepted full-payment retry after the balance is zero", async () => {
  expect(await recordInvoicePaymentAction("invoice", "10.00", "manual", requestId)).toEqual({ ok: true });
  expect(mocks.payment).toHaveBeenCalledWith("invoice", { request_id: requestId, amount_cents: 1000, payment_method: "manual" }, { id: "actor" });
  expect(mocks.get).not.toHaveBeenCalled();
});
it("lets the database answer an accepted full-refund retry after headroom is zero", async () => {
  expect(await refundInvoiceAction("invoice", "10.00", "Original ledger entry", requestId)).toEqual({ ok: true });
  expect(mocks.refund).toHaveBeenCalledWith("invoice", { request_id: requestId, amount_cents: 1000, reason: "Original ledger entry" }, { id: "actor" });
  expect(mocks.get).not.toHaveBeenCalled();
});
it("preserves authoritative new-payment and changed-payload refusal", async () => {
  mocks.payment.mockRejectedValue(new ValidationError("Payment exceeds balance."));
  expect(await recordInvoicePaymentAction("invoice", "10.00", "manual", requestId)).toEqual({ ok: false, error: "Payment exceeds balance." });
});
it("does not report a revoked financial replay as success", async () => {
  mocks.refund.mockRejectedValue(new PermissionDeniedError());
  expect(await refundInvoiceAction("invoice", "10.00", "Original ledger entry", requestId)).toMatchObject({ ok: false });
});
it("checks current payment capability before calling the database", async () => {
  mocks.markPaid = false;
  expect(await recordInvoicePaymentAction("invoice", "10.00", "manual", requestId)).toMatchObject({ ok: false });
  expect(mocks.payment).not.toHaveBeenCalled();
});
