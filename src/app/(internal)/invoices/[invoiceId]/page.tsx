import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDetailActions } from "../../../../components/invoices/invoice-detail-actions";
import styles from "../../../../components/invoices/invoice-admin.module.css";
import { InvoiceStatusBadge } from "../../../../components/invoices/invoice-status-badge";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatCurrencyCents, formatDate, formatDateTime } from "../../../../lib/format";
import { serviceDescriptionToPlainText } from "../../../../lib/service-description-html";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Invoice Detail" };

function invoiceLabel(value: number | null) {
  return value == null ? "Invoice Draft" : `Invoice #WF-${String(value).padStart(4, "0")}`;
}

function paymentMethodLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  const [{ invoiceId }, query, context] = await Promise.all([params, searchParams, getInternalContext()]);
  try {
    const detail = await context.services.invoices.get(invoiceId);
    const closedByRefund = ["partially_refunded", "refunded"].includes(detail.financials.presentation_state);
    const refundable = Math.max(detail.financials.gross_paid_cents - detail.financials.successful_refunds_cents, 0);
    return (
      <PageFrame
        title={invoiceLabel(detail.invoice.invoice_number)}
        description={detail.clientName}
        action={<InvoiceDetailActions invoiceId={detail.invoice.id} status={detail.invoice.status} currency={detail.invoice.currency} totalCents={detail.invoice.total_cents} grossPaidCents={detail.financials.gross_paid_cents} refundedCents={detail.financials.successful_refunds_cents} balanceDueCents={detail.financials.balance_due_cents} hasPendingPayment={detail.payments.some((payment) => payment.status === "pending")} capabilities={context.user.invoices} />}
      >
        <div className={styles.pageEnter}>
          {query.created ? <div className="success-banner">Invoice draft created.</div> : null}
          {query.saved ? <div className="success-banner">Invoice changes saved.</div> : null}
          <section className={styles.metadata} aria-label="Invoice information">
            <div><span>Status</span><InvoiceStatusBadge state={detail.financials.presentation_state} /></div>
            <div><span>Created</span><strong>{formatDate(detail.invoice.created_at)}</strong></div>
            <div><span>Issued</span><strong>{formatDate(detail.invoice.issued_at)}</strong></div>
            <div><span>Due</span><strong>{formatDate(detail.invoice.due_at)}</strong></div>
            <div><span>Paid</span><strong>{detail.payments.find((payment) => payment.status === "succeeded")?.settled_at ? formatDate(detail.payments.find((payment) => payment.status === "succeeded")?.settled_at ?? null) : "—"}</strong></div>
            <div><span>Currency</span><strong>{detail.invoice.currency}</strong></div>
          </section>

          <div className={styles.detailGrid}>
            <section className={styles.detailSection}><h2>Line items</h2><div className={styles.lineItems}><div className={styles.lineHeader}><span>Description</span><span>Qty</span><span>Unit price</span><span>Discount</span><span>Total</span></div>{detail.items.map((item) => <div className={styles.lineRow} key={item.id}><div><strong>{item.service_id ? <Link href={`/services/${item.service_id}`}>{item.name}</Link> : item.name}</strong>{item.description ? <small>{serviceDescriptionToPlainText(item.description)}</small> : null}</div><span data-label="Qty">{item.quantity}</span><span data-label="Unit price">{formatCurrencyCents(item.unit_price_cents, detail.invoice.currency)}</span><span data-label="Discount">{formatCurrencyCents(item.unit_discount_cents, detail.invoice.currency)}</span><strong data-label="Total">{formatCurrencyCents(item.line_subtotal_cents ?? 0, detail.invoice.currency)}</strong></div>)}</div></section>

            <aside className={styles.financialSummary}><h2>Financial summary</h2><dl><div><dt>Subtotal</dt><dd>{formatCurrencyCents(detail.invoice.subtotal_cents, detail.invoice.currency)}</dd></div><div><dt>Discount</dt><dd>−{formatCurrencyCents(detail.invoice.discount_total_cents, detail.invoice.currency)}</dd></div><div><dt>Tax</dt><dd>{formatCurrencyCents(detail.invoice.tax_total_cents, detail.invoice.currency)}</dd></div><div className={styles.totalLine}><dt>Total</dt><dd>{formatCurrencyCents(detail.invoice.total_cents, detail.invoice.currency)}</dd></div><div><dt>Paid</dt><dd>{formatCurrencyCents(detail.financials.gross_paid_cents, detail.invoice.currency)}</dd></div><div><dt>Refunded</dt><dd>{formatCurrencyCents(detail.financials.successful_refunds_cents, detail.invoice.currency)}</dd></div><div className={styles.balanceLine}><dt>Balance</dt><dd>{formatCurrencyCents(detail.financials.balance_due_cents, detail.invoice.currency)}</dd></div></dl>{closedByRefund ? <p className={styles.closedNote}>Closed — refunds do not reopen this invoice for collection.</p> : detail.invoice.status === "paid" ? <p className={styles.closedNote}>Settled in full.</p> : null}{detail.financials.presentation_state === "partially_refunded" ? <p className={styles.refundableNote}>{formatCurrencyCents(refundable, detail.invoice.currency)} remains refundable.</p> : null}</aside>
          </div>

          <div className={styles.historyGrid}>
            <section className={styles.detailSection}><h2>Payment history</h2>{detail.payments.length === 0 ? <p className={styles.emptyLedger}>No payments recorded.</p> : <><div className={styles.ledgerTable}><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>{detail.payments.map((payment) => <tr key={payment.id}><td>{formatDateTime(payment.settled_at ?? payment.created_at)}</td><td>{formatCurrencyCents(payment.amount_cents, payment.currency)}</td><td>{paymentMethodLabel(payment.payment_method)}</td><td><span className={styles.ledgerStatus} data-state={payment.status}>{statusLabel(payment.status)}</span></td></tr>)}</tbody></table></div><div className={styles.ledgerCards}>{detail.payments.map((payment) => <article key={payment.id}><header><strong>{formatCurrencyCents(payment.amount_cents, payment.currency)}</strong><span className={styles.ledgerStatus} data-state={payment.status}>{statusLabel(payment.status)}</span></header><span>{paymentMethodLabel(payment.payment_method)} · {formatDateTime(payment.settled_at ?? payment.created_at)}</span></article>)}</div></>}</section>
            <section className={styles.detailSection}><h2>Refund history</h2>{detail.refunds.length === 0 ? <p className={styles.emptyLedger}>No refunds recorded.</p> : <><div className={styles.ledgerTable}><table><thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Status</th></tr></thead><tbody>{detail.refunds.map((refund) => <tr key={refund.id}><td>{formatDateTime(refund.refunded_at ?? refund.created_at)}</td><td>{formatCurrencyCents(refund.amount_cents, refund.currency)}</td><td>{refund.reason}</td><td><span className={styles.ledgerStatus} data-state={refund.status}>{statusLabel(refund.status)}</span></td></tr>)}</tbody></table></div><div className={styles.ledgerCards}>{detail.refunds.map((refund) => <article key={refund.id}><header><strong>{formatCurrencyCents(refund.amount_cents, refund.currency)}</strong><span className={styles.ledgerStatus} data-state={refund.status}>{statusLabel(refund.status)}</span></header><span>{refund.reason} · {formatDateTime(refund.refunded_at ?? refund.created_at)}</span></article>)}</div></>}</section>
          </div>

          <section className={`${styles.detailSection} ${styles.activity}`}><h2>History</h2>{detail.activity.length === 0 ? <p className={styles.emptyLedger}>No activity recorded.</p> : <ol>{detail.activity.map((event) => <li key={event.id}><span aria-hidden="true" /><div><strong>{event.summary}</strong><small>{formatDateTime(event.created_at)}</small></div></li>)}</ol>}</section>
        </div>
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
