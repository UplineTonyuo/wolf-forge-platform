import { describe, expect, it } from "vitest";
import { navigationForCapabilities } from "../components/shell/nav-registry";
import { parseInvoiceFormData, parseMoneyToCents } from "../lib/invoices/form-data";
import { serviceDescriptionToPlainText } from "../lib/service-description-html";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";

function invoiceForm(items: unknown, overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    company_id: COMPANY_ID,
    currency: "USD",
    billing_reason: "manual",
    due_date: "2026-08-20",
    tax_total: "7.50",
    items: JSON.stringify(items),
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("Invoice admin form serialization", () => {
  it("parses money into integer cents without floating-point persistence", () => {
    expect(parseMoneyToCents("997.00")).toBe(99_700);
    expect(parseMoneyToCents("0.01")).toBe(1);
    expect(parseMoneyToCents("1.001")).toBeNull();
    expect(parseMoneyToCents("0.00")).toBeNull();
    expect(parseMoneyToCents("0.00", true)).toBe(0);
  });

  it("preserves ordered Service-backed and custom items", () => {
    const result = parseInvoiceFormData(invoiceForm([
      { service_id: SERVICE_ID, name: "Website Design", description: "Snapshot", quantity: 2, unit_price_cents: 99_700, unit_discount_cents: 2_000, is_taxable: true },
      { service_id: null, name: "Custom discovery", description: null, quantity: 1, unit_price_cents: 30_000, unit_discount_cents: 0, is_taxable: false },
    ]));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]?.service_id).toBe(SERVICE_ID);
    expect(result.data.items[1]?.service_id).toBeNull();
    expect(result.data.tax_total_cents).toBe(750);
    expect(result.data.due_at).toBe("2026-08-20T23:59:59+08:00");
  });

  it("rejects an excessive per-unit discount and an empty item list", () => {
    const excessive = parseInvoiceFormData(invoiceForm([
      { service_id: null, name: "Custom", description: null, quantity: 1, unit_price_cents: 100, unit_discount_cents: 101, is_taxable: true },
    ]));
    expect(excessive.success).toBe(false);
    const empty = parseInvoiceFormData(invoiceForm([]));
    expect(empty.success).toBe(false);
  });

  it("snapshots Service descriptions as decoded plain text", () => {
    expect(serviceDescriptionToPlainText("<p>Offers &amp; messaging<br>Safe</p>"))
      .toBe("Offers & messaging Safe");
  });
});

describe("Invoice capability navigation", () => {
  it("hides Invoices from a member without invoice access", () => {
    const labels = navigationForCapabilities(true, false).flatMap((category) => category.items.map((item) => item.label));
    expect(labels).not.toContain("Invoices");
  });

  it("shows Invoices when access is granted", () => {
    const labels = navigationForCapabilities(true, true).flatMap((category) => category.items.map((item) => item.label));
    expect(labels).toContain("Invoices");
  });
});
