import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { subscriptionAttention } from "../../domain/client-portal/attention";
import {
  recurringAmountLabel,
  renewalCadence,
} from "../../domain/client-portal/subscription-language";
import type { SubscriptionDetail, SubscriptionSummary } from "../../domain/subscriptions/schema";
import { formatCurrencyCents, formatDate } from "../../lib/format";
import { invoiceDisplayNumber } from "../../lib/subscriptions/presentation";
import { AttentionPill } from "../account/ui/attention-pill";
import { ClientSubscriptionCalendarTrigger } from "./client-subscription-calendar-trigger";
import type { SubscriptionInvoiceView } from "./subscription-detail";
import { invoiceAttention } from "../../domain/client-portal/attention";

/**
 * Client Subscriptions.
 *
 * The calculations are the internal ones, untouched: amounts, next billing date
 * and cycle history all come from app_list_subscription_summaries and
 * app_get_subscription_detail, which already strip internal columns for a
 * client caller. What changes here is the vocabulary — a client sees an
 * investment in an ongoing service, not a recurring fulfillment plan version.
 */

export function ClientSubscriptionsList({ summaries }: { summaries: SubscriptionSummary[] }) {
  const live = summaries.filter((summary) => summary.status !== "canceled");
  const ended = summaries.filter((summary) => summary.status === "canceled");

  function Row({ summary }: { summary: SubscriptionSummary }) {
    const attention = subscriptionAttention(summary.status);

    return (
      <li key={summary.subscription_id}>
        <Link
          href={`/account/subscriptions/${summary.subscription_id}`}
          className="portal-subscription-row"
        >
          <span className="portal-subscription-main">
            <span className="portal-project-ref">{summary.public_ref}</span>
            <strong>{summary.service_name}</strong>
            <span>
              {summary.status === "canceled"
                ? "Ended"
                : summary.next_payment_on
                  ? `Next billing ${formatDate(summary.next_payment_on)}`
                  : "No billing date scheduled"}
            </span>
          </span>

          <AttentionPill tone={attention.tone} label={attention.label} />

          <span className="portal-subscription-amount">
            <strong>{formatCurrencyCents(summary.amount_cents, summary.currency)}</strong>
            <span>{recurringAmountLabel(summary.interval_unit, summary.interval_count)}</span>
          </span>

          <ChevronRight aria-hidden="true" />
        </Link>
      </li>
    );
  }

  return (
    <div className="portal-page">
      <header className="portal-page-head portal-page-head-actions">
        <div>
          <span className="portal-eyebrow">Billing</span>
          <h1>Subscriptions</h1>
          <p>Your ongoing services, what they cost and when they renew.</p>
        </div>
        <ClientSubscriptionCalendarTrigger />
      </header>

      {summaries.length === 0 ? (
        <p className="portal-empty">
          No subscriptions yet. Ongoing services appear here with their renewal dates and invoice
          history.
        </p>
      ) : (
        <>
          {live.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-subs-live">
              <header className="portal-section-head">
                <h2 id="portal-subs-live">Ongoing services</h2>
              </header>
              <ul className="portal-subscription-list">
                {live.map((summary) => (
                  <Row key={summary.subscription_id} summary={summary} />
                ))}
              </ul>
            </section>
          ) : null}

          {ended.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-subs-ended">
              <header className="portal-section-head">
                <h2 id="portal-subs-ended">Ended</h2>
              </header>
              <ul className="portal-subscription-list">
                {ended.map((summary) => (
                  <Row key={summary.subscription_id} summary={summary} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ClientSubscriptionDetail({
  detail,
  summary,
  invoices,
}: {
  detail: SubscriptionDetail;
  summary: SubscriptionSummary;
  invoices: SubscriptionInvoiceView[];
}) {
  const { subscription, current_plan: plan, plan_items: items } = detail;
  const attention = subscriptionAttention(summary.status);
  const currentInvoice = invoices.find((invoice) =>
    ["unpaid", "overdue", "payment_pending"].includes(invoice.presentationState),
  );

  // The internal calculation, unchanged: quantity × (unit − unit discount).
  const amount = items.reduce(
    (total, item) => total + item.quantity * (item.unit_amount_cents - item.unit_discount_cents),
    0,
  );

  return (
    <article className="portal-page">
      <Link href="/account/subscriptions" className="portal-back">
        <ArrowLeft aria-hidden="true" />
        All subscriptions
      </Link>

      <header className="portal-page-head portal-page-head-actions">
        <div>
          <span className="portal-eyebrow">{summary.public_ref}</span>
          <h1>{summary.service_name}</h1>
          <p>{renewalCadence(plan.interval_unit, plan.interval_count)}</p>
        </div>
        <AttentionPill tone={attention.tone} label={attention.label} />
      </header>

      {summary.status === "past_due" ? (
        <div className="portal-callout" data-tone="payment_due">
          <strong>A payment is due on this subscription.</strong>
          {currentInvoice ? (
            <span>
              <Link href={`/account/invoices/${currentInvoice.id}`}>
                View the open invoice
              </Link>{" "}
              to settle it.
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
       * "stalled" and "requires_attention" are internal billing-engine health
       * states. A client is told plainly that Wolf Forge is looking at it,
       * without being handed the engine's vocabulary.
       */}
      {summary.health === "stalled" || summary.health === "requires_attention" ? (
        <div className="portal-callout" data-tone="in_progress">
          <strong>Wolf Forge is reviewing this subscription&rsquo;s billing.</strong>
          <span>Your invoice history below stays available while we do.</span>
        </div>
      ) : null}

      <dl className="portal-fact-grid">
        <div>
          <dt>{recurringAmountLabel(plan.interval_unit, plan.interval_count)}</dt>
          <dd>
            {formatCurrencyCents(amount, plan.currency)} {plan.currency}
          </dd>
        </div>
        <div>
          <dt>Next billing</dt>
          <dd>
            {summary.status === "canceled"
              ? "—"
              : summary.next_payment_on
                ? formatDate(summary.next_payment_on)
                : "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDate(subscription.started_at)}</dd>
        </div>
        <div>
          <dt>Last payment</dt>
          <dd>{summary.last_payment_at ? formatDate(summary.last_payment_at) : "—"}</dd>
        </div>
      </dl>

      <section className="portal-section" aria-labelledby="client-subscription-included">
        <header className="portal-section-head">
          <h2 id="client-subscription-included">What&rsquo;s included</h2>
        </header>
        <ul className="portal-included-list">
          {items.map((item, index) => (
            <li key={`${item.service_name_snapshot}-${index}`}>
              <strong>{item.service_name_snapshot}</strong>
              {item.quantity > 1 ? <span>×{item.quantity}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="portal-section" aria-labelledby="client-invoice-history">
        <header className="portal-section-head">
          <h2 id="client-invoice-history">Invoice history</h2>
        </header>

        {invoices.length === 0 ? (
          <p className="portal-empty">No invoices have been issued for this subscription yet.</p>
        ) : (
          <ul className="portal-invoice-list">
            {invoices.map((invoice) => {
              const invoiceState = invoiceAttention(invoice.presentationState);

              return (
                <li key={invoice.id}>
                  <Link href={`/account/invoices/${invoice.id}`} className="portal-invoice-row">
                    <span className="portal-invoice-main">
                      <strong>
                        <FileText aria-hidden="true" />
                        {invoiceDisplayNumber(invoice.invoiceNumber)}
                      </strong>
                      <span>Due {formatDate(invoice.dueAt)}</span>
                    </span>

                    <AttentionPill tone={invoiceState.tone} label={invoiceState.label} />

                    <span className="portal-invoice-amounts">
                      <strong>
                        {formatCurrencyCents(invoice.totalCents, invoice.currency)}
                      </strong>
                    </span>

                    <ChevronRight aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}
