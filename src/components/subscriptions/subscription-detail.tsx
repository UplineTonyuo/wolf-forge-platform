"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { SubscriptionDetail, SubscriptionSummary } from "../../domain/subscriptions/schema";
import { formatCurrencyCents, formatDate, formatDateTime } from "../../lib/format";
import { serviceDescriptionBlocks } from "../../lib/service-description-html";
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

const tabs = ["overview", "billing", "invoices", "history"] as const;
type Tab = typeof tabs[number];

function lineTotal(quantity: number, amount: number, discount: number) {
  return quantity * (amount - discount);
}

export function SubscriptionDetailView({ detail, summary, invoices }: {
  detail: SubscriptionDetail;
  summary: SubscriptionSummary;
  invoices: SubscriptionInvoiceView[];
}) {
  const { subscription, current_plan: plan, plan_items: items, cycles, events } = detail;
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const amount = items.reduce((total, item) => total + lineTotal(item.quantity, item.unit_amount_cents, item.unit_discount_cents), 0);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next]!;
    setActiveTab(tab);
    document.getElementById(`subscription-tab-${tab}`)?.focus();
  }

  return (
    <div className={styles.detailRoot}>
      {summary.health === "requires_attention" || summary.health === "stalled" ? <div className={styles.attentionBanner} role="status"><strong>{summary.health === "stalled" ? "Billing is stalled" : "Billing requires attention"}</strong><span>{summary.health === "stalled" ? "The current period is beyond its grace window. Review the linked billing cycle and Invoice." : "A linked Invoice was invalidated. The cycle remains recorded for an auditable operator decision."}</span></div> : null}
      <div className={styles.detailTabs} role="tablist" aria-label="Subscription detail sections">
        {tabs.map((tab, index) => <button key={tab} type="button" role="tab" id={`subscription-tab-${tab}`} aria-controls={`subscription-panel-${tab}`} aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={(event) => onTabKeyDown(event, index)}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>)}
      </div>

      <div id="subscription-panel-overview" role="tabpanel" aria-labelledby="subscription-tab-overview" hidden={activeTab !== "overview"} tabIndex={0}>
        <section className={styles.overview} aria-labelledby="overview-heading">
          <h2 id="overview-heading">Subscription summary</h2>
          <dl>
            <div><dt>Client</dt><dd><Link href={`/clients/${summary.company_id}`}>{summary.company_name}</Link></dd></div>
            <div><dt>Status</dt><dd><SubscriptionStatusBadge status={summary.status} /></dd></div>
            {summary.health !== "active" ? <div><dt>Health</dt><dd><SubscriptionHealthBadge health={summary.health} status={summary.status} /></dd></div> : null}
            <div><dt>Started</dt><dd>{formatDate(subscription.started_at)}</dd></div>
            <div><dt>Next billing</dt><dd>{summary.status === "canceled" ? "—" : formatDate(subscription.current_period_end)}</dd></div>
            <div><dt>Amount</dt><dd>{formatCurrencyCents(amount, plan.currency)} <span className={styles.mutedValue}>{plan.currency}</span></dd></div>
            <div><dt>Billing interval</dt><dd>{formatSubscriptionInterval(plan.interval_unit, plan.interval_count)}</dd></div>
            <div><dt>Plan source</dt><dd>{humanizeSubscriptionValue(subscription.plan_source)}</dd></div>
            <div><dt>Reference</dt><dd className={styles.subscriptionReference}>{summary.public_ref}</dd></div>
            {subscription.paused_at ? <div><dt>Paused</dt><dd>{formatDateTime(subscription.paused_at)}</dd></div> : null}
            {subscription.resumes_at ? <div><dt>Scheduled resume</dt><dd>{formatDate(subscription.resumes_at)}</dd></div> : null}
            {subscription.cancel_effective_at ? <div><dt>Cancellation effective</dt><dd>{formatDate(subscription.cancel_effective_at)}</dd></div> : null}
            {subscription.cancellation_reason ? <div><dt>Cancellation reason</dt><dd>{subscription.cancellation_reason}</dd></div> : null}
          </dl>
        </section>
        <section className={styles.planSection} aria-labelledby="current-plan-heading">
          <header><div><h2 id="current-plan-heading">Current plan <span className={styles.mutedValue}>· Version {plan.version}</span></h2><p>Effective {formatDate(plan.effective_from)}</p></div></header>
          <div className={styles.planBody}>
            <div className={styles.planLead}><Link href={`/services/${summary.service_id}`}>{summary.service_name}</Link><strong>{formatCurrencyCents(amount, plan.currency)} <span>/ {plan.interval_count === 1 ? plan.interval_unit : `${plan.interval_count} ${plan.interval_unit}s`}</span></strong></div>
            <dl className={styles.planFacts}>
              <div><dt>Lead time</dt><dd>{plan.lead_days} days</dd></div>
              <div><dt>Grace period</dt><dd>{plan.grace_days} days</dd></div>
              <div><dt>Recurring action</dt><dd>{humanizeSubscriptionValue(plan.recurring_action)}</dd></div>
              {plan.request_limit_total !== null || plan.request_limit_active !== null ? <div><dt>Requests</dt><dd>{plan.request_limit_total ?? "—"} total · {plan.request_limit_active ?? "—"} active</dd></div> : null}
            </dl>
            <div className={styles.lineItems}>
              <h3>Included services</h3>
              {items.map((item) => <div className={styles.lineRow} key={item.id}>
                <div><strong>{item.service_id ? <Link href={`/services/${item.service_id}`}>{item.service_name_snapshot}</Link> : item.service_name_snapshot}</strong>
                  {item.service_description_snapshot ? <ul className={styles.deliverables}>{serviceDescriptionBlocks(item.service_description_snapshot).map((block, index) => <li key={index}>{block}</li>)}</ul> : null}
                </div>
                <dl><div><dt>Quantity</dt><dd>{item.quantity}</dd></div><div><dt>Unit amount</dt><dd>{formatCurrencyCents(item.unit_amount_cents, plan.currency)}</dd></div><div><dt>Discount</dt><dd>{formatCurrencyCents(item.unit_discount_cents, plan.currency)}</dd></div><div><dt>Line total</dt><dd>{formatCurrencyCents(lineTotal(item.quantity, item.unit_amount_cents, item.unit_discount_cents), plan.currency)}</dd></div></dl>
              </div>)}
            </div>
          </div>
        </section>
      </div>

      <section className={styles.detailSection} id="subscription-panel-billing" role="tabpanel" aria-labelledby="subscription-tab-billing" hidden={activeTab !== "billing"} tabIndex={0}>
        <header><h2>Billing cycles</h2></header>
        {cycles.length === 0 ? <p className={styles.sectionEmpty}>No billing cycles are available.</p> : <div className={styles.cycleList}>{cycles.map((cycle) => {
          const invoice = cycle.invoice_id ? invoiceMap.get(cycle.invoice_id) : undefined;
          return <article className={styles.cycleCard} key={cycle.id}>
            <header><div><h3>Billing cycle {cycle.sequence}</h3><p>{formatDate(cycle.period_start)} – {formatDate(cycle.period_end)}</p></div><span className={styles.cycleStatus} data-state={cycle.status}>{humanizeSubscriptionValue(cycle.status)}</span></header>
            <dl><div><dt>Issue date</dt><dd>{formatDate(cycle.issue_on)}</dd></div><div><dt>Due date</dt><dd>{formatDate(cycle.due_on)}</dd></div><div><dt>Invoice</dt><dd>{cycle.invoice_id ? <Link href={`/invoices/${cycle.invoice_id}`}>{invoiceDisplayNumber(invoice?.invoiceNumber ?? null)}</Link> : "Not issued"}</dd></div><div><dt>Settlement</dt><dd>{formatDateTime(cycle.settled_at)}</dd></div><div><dt>Fulfillment</dt><dd>{humanizeSubscriptionValue(cycle.fulfillment_status)}</dd></div></dl>
          </article>;
        })}</div>}
      </section>

      <section className={styles.detailSection} id="subscription-panel-invoices" role="tabpanel" aria-labelledby="subscription-tab-invoices" hidden={activeTab !== "invoices"} tabIndex={0}>
        <header><h2>Invoices</h2></header>
        {invoices.length === 0 ? <p className={styles.sectionEmpty}>No invoices generated yet.</p> : <div className={styles.invoiceRows}>{invoices.map((invoice) => <Link href={`/invoices/${invoice.id}`} key={invoice.id}><div><strong>{invoiceDisplayNumber(invoice.invoiceNumber)}</strong><span>Due {formatDate(invoice.dueAt)}</span></div><strong>{formatCurrencyCents(invoice.totalCents, invoice.currency)}</strong><span className={styles.cycleStatus} data-state={invoice.presentationState}>{humanizeSubscriptionValue(invoice.presentationState)}</span></Link>)}</div>}
      </section>

      <section className={`${styles.detailSection} ${styles.historySection}`} id="subscription-panel-history" role="tabpanel" aria-labelledby="subscription-tab-history" hidden={activeTab !== "history"} tabIndex={0}>
        <header><h2>History</h2></header>
        {events.length === 0 ? <p className={styles.sectionEmpty}>No internal events are available.</p> : <ol>{events.map((event) => {
          const invoiceId = typeof event.payload === "object" && event.payload && !Array.isArray(event.payload) && typeof event.payload.invoice_id === "string" ? event.payload.invoice_id : null;
          const invoice = invoiceId ? invoiceMap.get(invoiceId) : undefined;
          return <li key={event.id}><span aria-hidden="true" /><div><strong>{subscriptionEventLabels[event.event_type]}</strong><small>{formatDateTime(event.occurred_at)} · {humanizeSubscriptionValue(event.actor_type)}{event.cycle_id ? " · Billing cycle event" : ""}</small>{invoiceId ? <Link href={`/invoices/${invoiceId}`}>{invoiceDisplayNumber(invoice?.invoiceNumber ?? null)}</Link> : null}</div></li>;
        })}</ol>}
      </section>
    </div>
  );
}
