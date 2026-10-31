import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintInvoiceButton } from "../../../../components/account/billing/print-invoice-button";
import { invoiceShareTokenSchema, type PublicInvoiceShare } from "../../../../domain/invoices/manual-payments";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatCurrencyCents, formatDate } from "../../../../lib/format";
import { createNextServerSupabaseClient } from "../../../../lib/supabase/next-server";
import { InvoiceRepository } from "../../../../repositories/invoice-repository";
import styles from "./public-invoice.module.css";

// Every request rechecks expiry, revocation, Tenant/module state and financials.
// Never generateStaticParams, cache this projection, or fetch it from metadata.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Invoice",
  description: "View a shared Wolf Forge invoice.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

function PublicInvoiceUnavailable({ limited }: { limited: boolean }) {
  return <main className={styles.shell}><section className={styles.page} aria-labelledby="invoice-unavailable-title">
    <span className="portal-eyebrow">Wolf Forge</span>
    <h1 id="invoice-unavailable-title">{limited ? "Please wait before trying again" : "Invoice temporarily unavailable"}</h1>
    <p role="status">{limited ? "This invoice has had too many views. Wait a few minutes before trying again." : "We could not load this invoice. Please try again later."}</p>
    {/* Native current-document retry: no extra public token in markup or prefetch. */}
    <a href="" className="button-secondary">Try again</a>
  </section></main>;
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const parsed = invoiceShareTokenSchema.safeParse((await params).token);
  if (!parsed.success) notFound();

  let share: PublicInvoiceShare;
  try {
    // Existing publishable-key SSR client; no verified actor or service key is
    // required for this capability projection. Do not forward impersonation.
    const client = await createNextServerSupabaseClient({ support: false });
    share = await new InvoiceRepository(client).getPublicShare(parsed.data);
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "NOT_FOUND" || safe.code === "VALIDATION_ERROR" || safe.code === "PERMISSION_DENIED") notFound();
    return <PublicInvoiceUnavailable limited={safe.code === "RATE_LIMITED"} />;
  }

  const { invoice, settings } = share;
  const payable = invoice.status === "unpaid" && invoice.balance_due_cents > 0;
  const showInstructions = settings.enabled && payable && !invoice.payment_reported;
  const paymentHref = `/pay/invoices/${invoice.id}`;
  const label = invoice.payment_reported && payable ? "Payment under review" : invoice.status === "paid" ? "Paid" : "Unpaid";

  return <main className={styles.shell}><article className={`portal-page portal-invoice-detail ${styles.page}`}>
    <header className="portal-invoice-hero">
      <div><span className="portal-eyebrow">Wolf Forge</span><h1>Invoice #{invoice.number}</h1><p>{invoice.company_name}</p></div>
      <div className="portal-invoice-hero-amount"><span className={styles.status}>{label}</span><span className="portal-billing-label">{payable ? "Balance due" : "Invoice total"}</span><strong>{formatCurrencyCents(payable ? invoice.balance_due_cents : invoice.total_cents, invoice.currency)}</strong></div>
    </header>
    <dl className="portal-fact-grid">
      <div><dt>Billed to</dt><dd>{invoice.company_name}</dd></div>
      <div><dt>Issued</dt><dd>{invoice.issued_at ? formatDate(invoice.issued_at) : "Not available"}</dd></div>
      <div><dt>Due</dt><dd>{invoice.due_at ? formatDate(invoice.due_at) : "No due date"}</dd></div>
      <div><dt>Currency</dt><dd>{invoice.currency}</dd></div>
    </dl>
    <div className="portal-invoice-content">
      <section className="portal-invoice-items" aria-labelledby="shared-invoice-items-title">
        <h2 id="shared-invoice-items-title">Items</h2>
        <div className="portal-invoice-item-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Price</span><span>Total</span></div>
        {invoice.items.map((item, index) => <div className="portal-invoice-item" key={index}>
          <div><strong>{item.name}</strong>{item.description ? <p className={styles.description}>{item.description}</p> : null}</div>
          <span data-label="Quantity">{item.quantity}</span><span data-label="Price">{formatCurrencyCents(item.unit_price_cents, invoice.currency)}</span><strong data-label="Total">{formatCurrencyCents(item.total_cents, invoice.currency)}</strong>
        </div>)}
      </section>
      <aside className="portal-invoice-totals" aria-label="Invoice totals"><dl>
        <div><dt>Subtotal</dt><dd>{formatCurrencyCents(invoice.subtotal_cents, invoice.currency)}</dd></div>
        {invoice.discount_total_cents > 0 ? <div><dt>Discount</dt><dd>−{formatCurrencyCents(invoice.discount_total_cents, invoice.currency)}</dd></div> : null}
        {invoice.tax_total_cents > 0 ? <div><dt>Tax</dt><dd>{formatCurrencyCents(invoice.tax_total_cents, invoice.currency)}</dd></div> : null}
        <div className="portal-invoice-total"><dt>Total</dt><dd>{formatCurrencyCents(invoice.total_cents, invoice.currency)}</dd></div>
        {invoice.successful_paid_cents > 0 ? <div><dt>Payments recorded</dt><dd>{formatCurrencyCents(invoice.successful_paid_cents, invoice.currency)}</dd></div> : null}
        <div className="portal-invoice-total"><dt>Balance due</dt><dd>{formatCurrencyCents(invoice.balance_due_cents, invoice.currency)}</dd></div>
      </dl></aside>
    </div>
    <div className="portal-invoice-actions"><PrintInvoiceButton /></div>
    {payable ? <section className={styles.payment} aria-labelledby="shared-invoice-payment-title">
      <h2 id="shared-invoice-payment-title">{invoice.payment_reported ? "Payment under review" : "Payment options"}</h2>
      {invoice.payment_reported ? <p role="status">A payment receipt has been submitted. Your team will verify receipt of the money before confirming payment.</p> : null}
      {showInstructions ? <>
        {settings.instructions ? <p className={styles.instructions}>{settings.instructions}</p> : null}
        <p>Pay the full outstanding balance. After paying outside the portal, sign in to submit your receipt screenshot.</p>
        {settings.paypal_url ? <a href={settings.paypal_url} className="button-secondary" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open PayPal</a> : null}
      </> : null}
      <div className={styles.actions}><a className="button-primary" href={paymentHref}>{invoice.payment_reported ? "Sign in to view payment status" : "Sign in for payment options"}</a></div>
      <p className={styles.note}>Receipt submission requires sign-in to the client account for this invoice.</p>
    </section> : null}
  </article></main>;
}
