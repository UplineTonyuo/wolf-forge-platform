import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError, NotFoundError, RateLimitedError } from "../lib/errors/application-error";
import type { PublicInvoiceShare } from "../domain/invoices/manual-payments";

const { getPublicShare, createClient, notFound } = vi.hoisted(() => ({ getPublicShare: vi.fn(), createClient: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("../lib/supabase/next-server", () => ({ createNextServerSupabaseClient: createClient }));
vi.mock("../repositories/public-invoice-share-repository", () => ({ readPublicInvoiceShare: getPublicShare }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../components/account/billing/print-invoice-button", () => ({ PrintInvoiceButton: () => <button>Print or save as PDF</button> }));

const { default: Page, metadata, dynamic } = await import("../app/share/invoices/[token]/page");
const token = "ab".repeat(32);
const invoiceId = "10000000-0000-4000-8000-000000000001";
function fixture(): PublicInvoiceShare {
  return {
    invoice: { id: invoiceId, tenant_id: "10000000-0000-4000-8000-000000000002", number: "WF-0010", company_name: "Synthetic Invoice Client", status: "unpaid", currency: "USD", subtotal_cents: 35000, discount_total_cents: 1000, tax_total_cents: 2000, total_cents: 36000, balance_due_cents: 35000, successful_paid_cents: 1000, payment_reported: false, issued_at: "2026-10-31T12:00:00Z", due_at: null, items: [{ name: "Synthetic Service", description: "Included deliverables", quantity: 1, unit_price_cents: 35000, total_cents: 35000 }] },
    settings: { enabled: true, paypal_url: "https://paypal.me/syntheticpayee", instructions: "Include invoice number in payment reference." },
  };
}
async function html(value = token) { return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: value }) })); }
beforeEach(() => { vi.clearAllMocks(); createClient.mockResolvedValue({}); getPublicShare.mockResolvedValue(fixture()); });
afterEach(() => { vi.restoreAllMocks(); });

describe("anonymous invoice projection page", () => {
  it("loads once through the existing publishable-key client without impersonation", async () => {
    const rendered = await html();
    expect(createClient).toHaveBeenCalledExactlyOnceWith({ support: false });
    expect(getPublicShare).toHaveBeenCalledExactlyOnceWith({}, token);
    expect(rendered).toContain("Invoice #WF-0010");
    expect(rendered).toContain("Synthetic Invoice Client");
    expect(rendered).toContain("Synthetic Service");
    expect(rendered).toContain("$350.00");
    expect(rendered).toContain("$10.00");
    expect(rendered).toContain("$20.00");
    expect(rendered).toContain("$360.00");
    expect(rendered).not.toContain(token);
  });
  it.each(["", "ab", token.toUpperCase(), `${token}\n`, "a".repeat(10000)])("rejects malformed token before calling the database", async (value) => {
    await expect(html(value)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(createClient).not.toHaveBeenCalled();
    expect(getPublicShare).not.toHaveBeenCalled();
  });
  it("shows instructions without exposing receipt reporting to anonymous visitors", async () => {
    const rendered = await html();
    expect(rendered).toContain("Include invoice number in payment reference.");
    expect(rendered).toContain("https://paypal.me/syntheticpayee");
    expect(rendered).toContain('rel="noopener noreferrer"');
    expect(rendered).toMatch(/referrerpolicy="no-referrer"/i);
    expect(rendered).toContain(`href="/pay/invoices/${invoiceId}"`);
    expect(rendered).toContain("Receipt submission requires sign-in");
    expect(rendered).not.toMatch(/type="file"|<form|I(?:&#x27;|')ve paid|invoice-payment-receipts/);
    expect(rendered).not.toContain("Wolf Forge Balance");
  });
  it("shows pending verification without changing the unpaid balance or encouraging another payment", async () => {
    const value = fixture(); value.invoice.payment_reported = true;
    getPublicShare.mockResolvedValue(value);
    const rendered = await html();
    expect(rendered).toContain("Payment under review");
    expect(rendered).toContain("$350.00");
    expect(rendered).toContain("Sign in to view payment status");
    expect(rendered).not.toContain("paypal.me");
    expect(rendered).not.toContain(value.settings.instructions);
    expect(rendered).not.toContain("Paid</span>");
  });
  it("does not render retained instructions or a PayPal CTA while settings are disabled", async () => {
    const value = fixture(); value.settings.enabled = false;
    getPublicShare.mockResolvedValue(value);
    const rendered = await html();
    expect(rendered).not.toContain(value.settings.instructions);
    expect(rendered).not.toContain("paypal.me");
    expect(rendered).toContain(`href="/pay/invoices/${invoiceId}"`);
  });
  it("a paid invoice does not invite another payment", async () => {
    const value = fixture(); value.invoice.status = "paid"; value.invoice.balance_due_cents = 0;
    getPublicShare.mockResolvedValue(value);
    const rendered = await html();
    expect(rendered).toContain("Paid");
    expect(rendered).not.toContain("paypal.me");
    expect(rendered).not.toContain("/pay/invoices/");
  });
  it("renders invoice text as text, without a stored-HTML execution surface", async () => {
    const value = fixture(); value.invoice.items[0]!.description = '<script>alert("test")</script>';
    value.settings.instructions = '<img src="bad" onerror="test">';
    getPublicShare.mockResolvedValue(value);
    const rendered = await html();
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("&lt;img");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain('<img src="bad"');
  });
  it("never renders private extra fields accidentally returned by a future repository", async () => {
    getPublicShare.mockResolvedValue({ ...fixture(), contacts: [{ email: "synthetic@example.invalid" }], receipts: ["PRIVATE_RECEIPT"], wallet: "PRIVATE_WALLET", history: ["PRIVATE_HISTORY"] });
    const rendered = await html();
    expect(rendered).not.toMatch(/synthetic@example|PRIVATE_RECEIPT|PRIVATE_WALLET|PRIVATE_HISTORY/);
  });
  it("keeps missing/expired/revoked links generically not found", async () => {
    getPublicShare.mockRejectedValue(new NotFoundError("Invoice"));
    await expect(html()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("handles rate limiting with a wait/retry state, never a raw error or missing-invoice claim", async () => {
    getPublicShare.mockRejectedValue(new RateLimitedError(new Error(`/share/invoices/${token}`)));
    const rendered = await html();
    expect(rendered).toContain("Please wait before trying again");
    expect(rendered).toContain('href=""');
    expect(rendered).not.toContain(token);
    expect(notFound).not.toHaveBeenCalled();
  });
  it("a transient database failure returns generic retry copy", async () => {
    getPublicShare.mockRejectedValue(new DatabaseError(new Error(`PRIVATE_DETAIL /share/invoices/${token}`)));
    const rendered = await html();
    expect(rendered).toContain("Invoice temporarily unavailable");
    expect(rendered).not.toContain(token);
    expect(rendered).not.toContain("PRIVATE_DETAIL");
  });
  it("has static noindex/no-referrer metadata and uncached request rendering", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata).toMatchObject({ title: "Invoice", referrer: "no-referrer", robots: { index: false, follow: false, nocache: true } });
    expect(getPublicShare).not.toHaveBeenCalled();
  });
});
