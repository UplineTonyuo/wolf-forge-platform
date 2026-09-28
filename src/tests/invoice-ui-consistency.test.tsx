/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceForm } from "../components/invoices/invoice-form";
import { InvoicesFilter } from "../components/invoices/invoices-filter";
import { parseInvoiceFormData } from "../lib/invoices/form-data";

const { push, create } = vi.hoisted(() => ({ push: vi.fn(), create: vi.fn(async () => ({ error: null, fieldErrors: {} })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams("q=Acme") }));
vi.mock("../app/actions/invoices", () => ({ createInvoiceAction: create, updateInvoiceAction: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const companyId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";

describe("invoice UI consistency", () => {
  it.each(["all", "unpaid", "paid", "payment_pending", "refunded", "void", "overdue"])("applies %s while preserving search", (status) => {
    render(<InvoicesFilter value="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Filter invoices" }));
    const labels: Record<string, string> = { all: "All", unpaid: "Unpaid", paid: "Paid", payment_pending: "Payment Pending", refunded: "Refunded", void: "Void", overdue: "Overdue" };
    fireEvent.click(screen.getByRole("button", { name: labels[status] }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(push).toHaveBeenCalledWith(`/invoices?q=Acme${status === "all" ? "" : `&state=${status}`}`);
  });

  it("submits custom values and a folder-selected service with neutral tax", async () => {
    const { container } = render(<InvoiceForm mode="create" requestId="33333333-3333-4333-8333-333333333333" companies={[{ id: companyId, name: "Acme" }]} defaultCompanyId={companyId} defaultDueDate="2026-10-15" folders={[{ id: "seo", name: "SEO" }]} services={[{ id: serviceId, name: "SEO Strategy", description: "Scope", folderId: "seo", folderName: "SEO", priceCents: 49700, currency: "USD" }]} />);
    expect(container.querySelectorAll('select, input[type="date"], input[type="checkbox"]')).toHaveLength(0);
    expect(screen.queryByText("Tax total")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Item 1 type: Custom Item" }));
    fireEvent.click(await screen.findByRole("option", { name: "Service" }));
    fireEvent.click(screen.getByRole("button", { name: "Item 1 service: Choose a service" }));
    fireEvent.click(screen.getByRole("option", { name: /SEO\s*1 service/ }));
    fireEvent.click(screen.getByRole("option", { name: /SEO Strategy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Currency: USD" }));
    fireEvent.click(await screen.findByRole("option", { name: "GBP" }));
    fireEvent.click(screen.getByRole("button", { name: "Billing reason: Manual invoice" }));
    fireEvent.click(await screen.findByRole("option", { name: "Recurring payment" }));
    fireEvent.click(screen.getByRole("button", { name: /Due date:/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Friday, October 16, 2026" }));
    const form = container.querySelector("form")!;
    const parsed = parseInvoiceFormData(new FormData(form));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ company_id: companyId, currency: "GBP", billing_reason: "subscription_cycle", due_at: "2026-10-16T23:59:59+08:00", tax_total_cents: 0, items: [{ service_id: serviceId, name: "SEO Strategy", unit_price_cents: 49700, is_taxable: false }] });
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalled());
  });
});
