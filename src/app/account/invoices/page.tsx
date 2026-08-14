import type { Metadata } from "next";
import Link from "next/link";
import { formatCurrencyCents, formatDate } from "../../../lib/format";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Invoices" };

function invoiceLabel(value: number | null) {
  return value == null ? "Invoice draft" : `Invoice #WF-${String(value).padStart(4, "0")}`;
}

export default async function ClientInvoicesPage() {
  const context = await getClientContext();
  const invoices = await context.services.invoices.listForClient();

  return (
    <div className="client-invoices-index">
      <header>
        <span>CLIENT ACCOUNT</span>
        <h1>Invoices</h1>
        <p>Review balances and securely choose an available Wolf Forge payment method.</p>
      </header>
      <div className="client-invoice-list">
        {invoices.length ? invoices.map(({ invoice, financials }) => (
          <Link key={invoice.id} href={`/account/invoices/${invoice.id}`} className="client-invoice-row">
            <div>
              <strong>{invoiceLabel(invoice.invoice_number)}</strong>
              <span>Created {formatDate(invoice.created_at)} · Due {formatDate(invoice.due_at)}</span>
            </div>
            <div>
              <span>Amount due</span>
              <strong>{formatCurrencyCents(financials.balance_due_cents, invoice.currency)}</strong>
            </div>
          </Link>
        )) : <p className="client-invoice-empty">No invoices are available.</p>}
      </div>
    </div>
  );
}
