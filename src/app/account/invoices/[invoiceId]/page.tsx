import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { PrintInvoiceButton } from "../../../../components/account/billing/print-invoice-button";
import { AttentionPill } from "../../../../components/account/ui/attention-pill";
import { InvoicePaymentSelector } from "../../../../components/invoices/invoice-payment-selector";
import { invoiceAttention } from "../../../../domain/client-portal/attention";
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

    const { invoice, financials, items } = detail;
    const attention = invoiceAttention(financials.presentation_state);

    /*
     * Collectibility is the database's answer, not a UI guess: a refunded or
     * voided invoice is never presented as payable even when a balance figure
     * survives on the row.
     */
    const collectible =
      invoice.status === "unpaid"
      && financials.balance_due_cents > 0
      && !["refunded", "partially_refunded"].includes(financials.presentation_state);

    return (
      <article className="portal-page portal-invoice-detail">
        <Link href="/account/invoices" className="portal-back">
          <ArrowLeft aria-hidden="true" />
          All invoices
        </Link>

        <header className="portal-invoice-hero">
          <div>
            <span className="portal-eyebrow">Wolf Forge</span>
            <h1>{invoiceLabel(invoice.invoice_number)}</h1>
            <p>{detail.clientName}</p>
          </div>

          <div className="portal-invoice-hero-amount">
            <AttentionPill tone={attention.tone} label={attention.label} />
            <span className="portal-billing-label">
              {financials.balance_due_cents > 0 ? "Balance due" : "Invoice total"}
            </span>
            <strong>
              {formatCurrencyCents(
                financials.balance_due_cents > 0
                  ? financials.balance_due_cents
                  : invoice.total_cents,
                invoice.currency,
              )}
            </strong>
          </div>
        </header>

        <dl className="portal-fact-grid">
          <div>
            <dt>Billed to</dt>
            <dd>{detail.clientName}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>{formatDate(invoice.created_at)}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{invoice.due_at ? formatDate(invoice.due_at) : "No due date"}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{invoice.currency}</dd>
          </div>
        </dl>

        <div className="portal-invoice-content">
          <section className="portal-invoice-items" aria-labelledby="invoice-items-title">
            <h2 id="invoice-items-title">Items</h2>
            <div className="portal-invoice-item-head" aria-hidden="true">
              <span>Description</span>
              <span>Qty</span>
              <span>Price</span>
              <span>Total</span>
            </div>
            {items.map((item) => (
              <div className="portal-invoice-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  {item.description ? (
                    <span>{serviceDescriptionToPlainText(item.description)}</span>
                  ) : null}
                </div>
                <span data-label="Quantity">{item.quantity}</span>
                <span data-label="Price">
                  {formatCurrencyCents(item.unit_price_cents, invoice.currency)}
                </span>
                <strong data-label="Total">
                  {formatCurrencyCents(item.line_subtotal_cents ?? 0, invoice.currency)}
                </strong>
              </div>
            ))}
          </section>

          <aside className="portal-invoice-totals" aria-label="Invoice totals">
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatCurrencyCents(invoice.subtotal_cents, invoice.currency)}</dd>
              </div>
              {/* Only shown when a discount was actually applied. */}
              {invoice.discount_total_cents > 0 ? (
                <div>
                  <dt>Discount</dt>
                  <dd>−{formatCurrencyCents(invoice.discount_total_cents, invoice.currency)}</dd>
                </div>
              ) : null}
              {invoice.tax_total_cents > 0 ? (
                <div>
                  <dt>Tax</dt>
                  <dd>{formatCurrencyCents(invoice.tax_total_cents, invoice.currency)}</dd>
                </div>
              ) : null}
              <div className="portal-invoice-total">
                <dt>Total</dt>
                <dd>{formatCurrencyCents(invoice.total_cents, invoice.currency)}</dd>
              </div>
              {/*
               * Settled and refunded figures come straight from the financials
               * RPC's ledger, so a partial payment or a partial refund is shown
               * exactly as the database recorded it.
               */}
              {financials.gross_paid_cents > 0 ? (
                <div>
                  <dt>Amount paid</dt>
                  <dd>{formatCurrencyCents(financials.gross_paid_cents, invoice.currency)}</dd>
                </div>
              ) : null}
              {financials.successful_refunds_cents > 0 ? (
                <div>
                  <dt>Refunded</dt>
                  <dd>
                    −{formatCurrencyCents(financials.successful_refunds_cents, invoice.currency)}
                  </dd>
                </div>
              ) : null}
              <div className="portal-invoice-total">
                <dt>Balance due</dt>
                <dd>{formatCurrencyCents(financials.balance_due_cents, invoice.currency)}</dd>
              </div>
            </dl>
          </aside>
        </div>

        <div className="portal-invoice-actions">
          <PrintInvoiceButton />
        </div>

        {/*
         * The WF Card wallet is the only settlement path that exists. The
         * selector states that plainly and offers nothing it cannot perform —
         * there is no card provider behind it and it does not pretend otherwise.
         */}
        <InvoicePaymentSelector
          invoiceId={invoice.id}
          holderName={context.user.displayName ?? detail.clientName}
          invoiceBalanceCents={financials.balance_due_cents}
          currency={invoice.currency}
          walletBalanceCents={wallet.balance_cents}
          membershipStatus={
            (membership?.status ?? "inactive") as "inactive" | "pending" | "active" | "cancelled"
          }
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
