import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { InvoicePaymentSelector } from "../../../../components/invoices/invoice-payment-selector";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatCurrencyCents, formatDate } from "../../../../lib/format";
import { serviceDescriptionToPlainText } from "../../../../lib/service-description-html";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Invoice" };

function invoiceLabel(value: number | null) {
  return value == null ? "Invoice" : `Invoice #WF-${String(value).padStart(4, "0")}`;
}

export default async function ClientInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const [{ invoiceId }, context] = await Promise.all([params, getClientContext()]);

  try {
    const [detail, wallet, membership, offer] = await Promise.all([
      context.services.invoices.getForClient(invoiceId),
      context.services.wallets.getForCompany(context.user.companyId),
      context.services.wfCard.getMembership(context.user.companyId),
      context.services.wfCard.getOffer(),
    ]);
    const collectible = detail.invoice.status === "unpaid"
      && detail.financials.balance_due_cents > 0
      && !["refunded", "partially_refunded"].includes(detail.financials.presentation_state);

    return (
      <article className="client-invoice-detail">
        <Link href="/account/invoices" className="client-invoice-back">
          <ArrowLeft aria-hidden="true" /> All invoices
        </Link>
        <header className="client-invoice-hero">
          <div>
            <span>WOLF FORGE</span>
            <h1>{invoiceLabel(detail.invoice.invoice_number)}</h1>
            <p>{detail.clientName}</p>
          </div>
          <div className="client-invoice-amount">
            <span>Amount due</span>
            <strong>{formatCurrencyCents(detail.financials.balance_due_cents, detail.invoice.currency)}</strong>
          </div>
        </header>

        <dl className="client-invoice-meta">
          <div><dt>Client / company</dt><dd>{detail.clientName}</dd></div>
          <div><dt>Created</dt><dd>{formatDate(detail.invoice.created_at)}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(detail.invoice.due_at)}</dd></div>
        </dl>

        <div className="client-invoice-content">
          <section className="client-invoice-items" aria-labelledby="invoice-items-title">
            <h2 id="invoice-items-title">Items</h2>
            <div className="client-invoice-item-head" aria-hidden="true">
              <span>Description</span><span>Qty</span><span>Price</span><span>Total</span>
            </div>
            {detail.items.map((item) => (
              <div className="client-invoice-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  {item.description ? <span>{serviceDescriptionToPlainText(item.description)}</span> : null}
                </div>
                <span data-label="Quantity">{item.quantity}</span>
                <span data-label="Price">{formatCurrencyCents(item.unit_price_cents, detail.invoice.currency)}</span>
                <strong data-label="Total">{formatCurrencyCents(item.line_subtotal_cents ?? 0, detail.invoice.currency)}</strong>
              </div>
            ))}
          </section>

          <aside className="client-invoice-totals" aria-label="Invoice totals">
            <dl>
              <div><dt>Subtotal</dt><dd>{formatCurrencyCents(detail.invoice.subtotal_cents, detail.invoice.currency)}</dd></div>
              <div><dt>Discount</dt><dd>−{formatCurrencyCents(detail.invoice.discount_total_cents, detail.invoice.currency)}</dd></div>
              <div><dt>Tax</dt><dd>{formatCurrencyCents(detail.invoice.tax_total_cents, detail.invoice.currency)}</dd></div>
              <div className="client-invoice-total"><dt>Total</dt><dd>{formatCurrencyCents(detail.invoice.total_cents, detail.invoice.currency)}</dd></div>
            </dl>
          </aside>
        </div>

        <InvoicePaymentSelector
          invoiceId={detail.invoice.id}
          holderName={context.user.displayName ?? detail.clientName}
          invoiceBalanceCents={detail.financials.balance_due_cents}
          currency={detail.invoice.currency}
          walletBalanceCents={wallet.balance_cents}
          membershipStatus={(membership?.status ?? "inactive") as "inactive" | "pending" | "active" | "cancelled"}
          membershipPriceCents={offer.membershipPriceCents}
          membershipCurrency={offer.membershipCurrency}
          collectible={collectible}
        />
      </article>
    );
  } catch (error) {
    if (["NOT_FOUND", "PERMISSION_DENIED"].includes(toClientSafeError(error).code)) notFound();
    throw error;
  }
}
