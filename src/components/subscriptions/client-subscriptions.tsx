import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import type { SubscriptionDetail, SubscriptionSummary } from "../../domain/subscriptions/schema";
import { formatCurrencyCents, formatDate } from "../../lib/format";
import { formatSubscriptionInterval, invoiceDisplayNumber } from "../../lib/subscriptions/presentation";
import { SubscriptionStatusBadge } from "./subscription-status-badge";
import type { SubscriptionInvoiceView } from "./subscription-detail";
import styles from "./subscriptions.module.css";

export function ClientSubscriptionsList({ summaries }: { summaries: SubscriptionSummary[] }) {
  return (
    <div className={styles.clientRoot}>
      <header className={styles.clientPageHeader}><h1>Subscriptions</h1><p>Review your recurring Services, billing dates, and Invoice history.</p></header>
      {summaries.length === 0 ? <section className={styles.clientEmpty}><h2>No subscriptions yet</h2><p>Your active and historical subscriptions will appear here.</p></section> : <div className={styles.clientList}>{summaries.map((summary) => <Link href={`/account/subscriptions/${summary.subscription_id}`} key={summary.subscription_id}>
        <div className={styles.clientService}><strong>{summary.service_name}</strong><span className={styles.subscriptionReference}>{summary.public_ref}</span></div>
        <SubscriptionStatusBadge status={summary.status} />
        <div className={styles.clientAmount}><strong>{formatCurrencyCents(summary.amount_cents, summary.currency)}</strong><span>{formatSubscriptionInterval(summary.interval_unit, summary.interval_count)}</span></div>
        <dl><div><dt>Next billing</dt><dd>{summary.status === "canceled" ? "â€”" : formatDate(summary.next_payment_on)}</dd></div><div><dt>Last payment</dt><dd>{formatDate(summary.last_payment_at)}</dd></div></dl>
        <ChevronRight aria-hidden="true" />
      </Link>)}</div>}
    </div>
  );
}

export function ClientSubscriptionDetail({ detail, summary, invoices }: { detail: SubscriptionDetail; summary: SubscriptionSummary; invoices: SubscriptionInvoiceView[] }) {
  const { subscription, current_plan: plan, plan_items: items } = detail;
  const currentInvoice = invoices.find((invoice) => ["unpaid", "overdue", "payment_pending"].includes(invoice.presentationState));
  const amount = items.reduce((total, item) => total + item.quantity * (item.unit_amount_cents - item.unit_discount_cents), 0);

  return (
    <article className={styles.clientDetail}>
      <Link href="/account/subscriptions" className={styles.clientBack}><ArrowLeft aria-hidden="true" />All subscriptions</Link>
      <header className={styles.clientHero}>
        <div><h1>{summary.service_name}</h1><p className={styles.subscriptionReference}>{summary.public_ref}</p></div>
        <SubscriptionStatusBadge status={summary.status} />
      </header>
      {summary.status === "past_due" ? <div className={styles.clientPastDue}><strong>Payment is required on your current Invoice.</strong>{currentInvoice ? <Link href={`/account/invoices/${currentInvoice.id}`}>View Invoice <ChevronRight aria-hidden="true" /></Link> : null}</div> : null}
      {summary.health === "stalled" || summary.health === "requires_attention" ? <div className={styles.clientReviewNote}>Weâ€™re reviewing this Subscriptionâ€™s billing state. Your Invoice history remains available below.</div> : null}

      <dl className={styles.clientFacts}>
        <div><dt>Current price</dt><dd>{formatCurrencyCents(amount, plan.currency)} {plan.currency}<small>{formatSubscriptionInterval(plan.interval_unit, plan.interval_count)}</small></dd></div>
        <div><dt>Next billing</dt><dd>{summary.status === "canceled" ? "â€”" : formatDate(summary.next_payment_on)}</dd></div>
        <div><dt>Started</dt><dd>{formatDate(subscription.started_at)}</dd></div>
      </dl>

      <section className={styles.clientPlan}><h2>Current plan</h2><p>{items.map((item) => item.service_name_snapshot).join(", ")}</p><span>{items.length === 1 ? `${items[0]?.quantity ?? 1} recurring item` : `${items.length} recurring items`} Â· {plan.lead_days}-day Invoice lead Â· {plan.grace_days}-day grace</span></section>

      <section className={styles.clientInvoices} aria-labelledby="client-invoice-history"><h2 id="client-invoice-history">Invoice history</h2>{invoices.length === 0 ? <p>No Invoices have been generated.</p> : <div>{invoices.map((invoice) => <Link href={`/account/invoices/${invoice.id}`} key={invoice.id}><FileText aria-hidden="true" /><span><strong>{invoiceDisplayNumber(invoice.invoiceNumber)}</strong><small>Due {formatDate(invoice.dueAt)}</small></span><strong>{formatCurrencyCents(invoice.totalCents, invoice.currency)}</strong><span className={styles.cycleStatus} data-state={invoice.presentationState}>{invoice.presentationState.replaceAll("_", " ")}</span><ChevronRight aria-hidden="true" /></Link>)}</div>}</section>
    </article>
  );
}
