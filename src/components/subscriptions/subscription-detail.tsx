import Link from "next/link";
import type { SubscriptionDetail, SubscriptionSummary } from "../../domain/subscriptions/schema";
import { formatCurrencyCents, formatDate, formatDateTime } from "../../lib/format";
import { formatSubscriptionInterval, humanizeSubscriptionValue, invoiceDisplayNumber, subscriptionEventLabels } from "../../lib/subscriptions/presentation";
import { SubscriptionHealthBadge, SubscriptionStatusBadge } from "./subscription-status-badge";
import styles from "./subscriptions.module.css";

export type SubscriptionInvoiceView = {
  id: string;
  invoiceNumber: number | null;
  status: string;
  presentationState: string;
  totalCents: number;
  currency: string;
  dueAt: string | null;
};

function lineTotal(quantity: number, amount: number, discount: number) {
  return quantity * (amount - discount);
}

export function SubscriptionDetailView({
  detail,
  summary,
  invoices,
}: {
  detail: SubscriptionDetail;
  summary: SubscriptionSummary;
  invoices: SubscriptionInvoiceView[];
}) {
  const { subscription, current_plan: plan, plan_items: items, cycles, events } = detail;
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const amount = items.reduce((total, item) => total + lineTotal(item.quantity, item.unit_amount_cents, item.unit_discount_cents), 0);

  return (
    <div className={styles.detailRoot}>
      {summary.health === "requires_attention" || summary.health === "stalled" ? <div className={styles.attentionBanner} role="status"><strong>{summary.health === "stalled" ? "Billing is stalled" : "Billing requires attention"}</strong><span>{summary.health === "stalled" ? "The current period is beyond its grace window. Review the linked billing cycle and Invoice." : "A linked Invoice was invalidated. The cycle remains recorded for an auditable operator decision."}</span></div> : null}

      <nav className={styles.detailTabs} aria-label="Subscription detail sections"><a href="#overview">Overview</a><a href="#billing">Billing</a><a href="#invoices">Invoices</a><a href="#history">History</a></nav>

      <section className={styles.overview} id="overview" aria-labelledby="overview-heading">
        <h2 className="sr-only" id="overview-heading">Overview</h2>
        <dl>
          <div><dt>Client / company</dt><dd><Link href={`/clients/${summary.company_id}`}>{summary.company_name}</Link></dd></div>
          <div><dt>Service</dt><dd><Link href={`/services/${summary.service_id}`}>{summary.service_name}</Link></dd></div>
          <div><dt>Subscription reference</dt><dd><span className={styles.subscriptionReference}>{summary.public_ref}</span></dd></div>
          <div><dt>Status</dt><dd><SubscriptionStatusBadge status={summary.status} /></dd></div>
          <div><dt>Health</dt><dd><SubscriptionHealthBadge health={summary.health} status={summary.status} /></dd></div>
          <div><dt>Started</dt><dd>{formatDate(subscription.started_at)}</dd></div>
        </dl>
        <dl>
          <div><dt>Next billing / period end</dt><dd>{summary.status === "canceled" ? "â€”" : formatDate(subscription.current_period_end)}</dd></div>
          <div><dt>Current amount</dt><dd>{formatCurrencyCents(amount, plan.currency)}</dd></div>
          <div><dt>Currency</dt><dd>{plan.currency}</dd></div>
          <div><dt>Billing interval</dt><dd>{formatSubscriptionInterval(plan.interval_unit, plan.interval_count)}</dd></div>
          <div><dt>Plan source</dt><dd>{humanizeSubscriptionValue(subscription.plan_source)}</dd></div>
          {subscription.paused_at ? <div><dt>Paused</dt><dd>{formatDateTime(subscription.paused_at)}</dd></div> : null}
          {subscription.resumes_at ? <div><dt>Scheduled resume</dt><dd>{formatDate(subscription.resumes_at)}</dd></div> : null}
          {subscription.cancel_effective_at ? <div><dt>Cancellation effective</dt><dd>{formatDate(subscription.cancel_effective_at)}</dd></div> : null}
          {subscription.cancellation_reason ? <div><dt>Cancellation reason</dt><dd>{subscription.cancellation_reason}</dd></div> : null}
        </dl>
      </section>

      <section className={styles.planSection} aria-labelledby="current-plan-heading">
        <header><div><h2 id="current-plan-heading">Current plan Â· Version {plan.version}</h2><p>Effective {formatDate(plan.effective_from)}. Prior versions and issued Invoices remain unchanged.</p></div></header>
        <dl className={styles.planFacts}>
          <div><dt>Billing interval</dt><dd>{formatSubscriptionInterval(plan.interval_unit, plan.interval_count)}</dd></div>
          <div><dt>Lead time</dt><dd>{plan.lead_days} days</dd></div>
          <div><dt>Grace period</dt><dd>{plan.grace_days} days</dd></div>
          <div><dt>Recurring action</dt><dd>{humanizeSubscriptionValue(plan.recurring_action)}</dd></div>
          {plan.request_limit_total ? <div><dt>Total requests</dt><dd>{plan.request_limit_total}</dd></div> : null}
          {plan.request_limit_active ? <div><dt>Active requests</dt><dd>{plan.request_limit_active}</dd></div> : null}
        </dl>
        <div className={styles.lineItems}>
          <div className={styles.lineHeader}><span>Name</span><span>Quantity</span><span>Unit amount</span><span>Discount</span><span>Line total</span></div>
          {items.map((item) => <div className={styles.lineRow} key={item.id}><div><strong>{item.service_id ? <Link href={`/services/${item.service_id}`}>{item.service_name_snapshot}</Link> : item.service_name_snapshot}</strong>{item.service_description_snapshot ? <small>{item.service_description_snapshot}</small> : null}</div><span data-label="Quantity">{item.quantity}</span><span data-label="Unit amount">{formatCurrencyCents(item.unit_amount_cents, plan.currency)}</span><span data-label="Discount">{formatCurrencyCents(item.unit_discount_cents, plan.currency)}</span><strong data-label="Line total">{formatCurrencyCents(lineTotal(item.quantity, item.unit_amount_cents, item.unit_discount_cents), plan.currency)}</strong></div>)}
        </div>
      </section>

      <section className={styles.detailSection} id="billing" aria-labelledby="billing-heading">
        <header><h2 id="billing-heading">Billing cycles</h2><p>Every period is durable and linked to at most one ordinary Wolf Forge Invoice.</p></header>
        {cycles.length === 0 ? <p className={styles.sectionEmpty}>No billing cycles are available.</p> : <div className={styles.cycleTable}><table><thead><tr><th>Cycle</th><th>Billing period</th><th>Issue date</th><th>Due date</th><th>Invoice</th><th>Status</th><th>Settlement</th><th>Fulfillment</th></tr></thead><tbody>{cycles.map((cycle) => {
          const invoice = cycle.invoice_id ? invoiceMap.get(cycle.invoice_id) : undefined;
          return <tr key={cycle.id}><td>{cycle.sequence}</td><td>{formatDate(cycle.period_start)} â€“ {formatDate(cycle.period_end)}</td><td>{formatDate(cycle.issue_on)}</td><td>{formatDate(cycle.due_on)}</td><td>{cycle.invoice_id ? <Link href={`/invoices/${cycle.invoice_id}`}>{invoiceDisplayNumber(invoice?.invoiceNumber ?? null)}</Link> : "Not issued"}</td><td><span className={styles.cycleStatus} data-state={cycle.status}>{humanizeSubscriptionValue(cycle.status)}</span></td><td>{formatDateTime(cycle.settled_at)}</td><td>{humanizeSubscriptionValue(cycle.fulfillment_status)}</td></tr>;
        })}</tbody></table></div>}
      </section>

      <section className={styles.detailSection} id="invoices" aria-labelledby="invoices-heading">
        <header><h2 id="invoices-heading">Invoices</h2><p>Payment and refund truth stays in the existing Invoice ledger.</p></header>
        {invoices.length === 0 ? <p className={styles.sectionEmpty}>No Invoices have been generated.</p> : <div className={styles.invoiceRows}>{invoices.map((invoice) => <Link href={`/invoices/${invoice.id}`} key={invoice.id}><div><strong>{invoiceDisplayNumber(invoice.invoiceNumber)}</strong><span>Due {formatDate(invoice.dueAt)}</span></div><strong>{formatCurrencyCents(invoice.totalCents, invoice.currency)}</strong><span className={styles.cycleStatus} data-state={invoice.presentationState}>{humanizeSubscriptionValue(invoice.presentationState)}</span></Link>)}</div>}
      </section>

      <section className={`${styles.detailSection} ${styles.historySection}`} id="history" aria-labelledby="history-heading">
        <header><h2 id="history-heading">History</h2><p>Permanent lifecycle and billing orchestration events.</p></header>
        {events.length === 0 ? <p className={styles.sectionEmpty}>No internal events are available.</p> : <ol>{events.map((event) => {
          const invoiceId = typeof event.payload === "object" && event.payload && !Array.isArray(event.payload) && typeof event.payload.invoice_id === "string" ? event.payload.invoice_id : null;
          const invoice = invoiceId ? invoiceMap.get(invoiceId) : undefined;
          return <li key={event.id}><span aria-hidden="true" /><div><strong>{subscriptionEventLabels[event.event_type]}</strong><small>{humanizeSubscriptionValue(event.actor_type)} Â· {formatDateTime(event.occurred_at)}{event.cycle_id ? " Â· Billing cycle event" : ""}</small>{invoiceId ? <Link href={`/invoices/${invoiceId}`}>{invoiceDisplayNumber(invoice?.invoiceNumber ?? null)}</Link> : null}</div></li>;
        })}</ol>}
      </section>
    </div>
  );
}
