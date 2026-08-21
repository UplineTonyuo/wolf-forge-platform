import { ArrowUpRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import {
  currencyBalanceFacts,
  type ClientBalance,
} from "../../../domain/client-portal/balance";
import type { ClientNextBilling } from "../../../domain/client-portal/summary";
import {
  primaryPaymentRail,
  type ClientPaymentRail,
} from "../../../domain/payments/payment-rails";
import { formatCurrencyCents } from "../../../lib/format";
import styles from "./client-deck.module.css";

/**
 * Billing, as one command strip.
 *
 * Three zones on a single surface, deliberately unequal: what is owed is the
 * anchor and takes the space, what is next and how it gets paid sit beside it
 * as supporting state. Equal thirds made three unrelated boxes out of one
 * account summary, which is the thing this replaces.
 *
 * Separation is spacing and a hairline, never a card. Each zone is itself the
 * link, so the whole area is the target rather than a small action at the foot
 * of a box. Zones the account is not entitled to are absent, never empty.
 */

/**
 * The anchor: what this account owes.
 *
 * One figure per currency, never a combined total — the platform has no FX rate
 * source, so adding them would require inventing one. The supporting counts come
 * from currencyBalanceFacts, the same parts the Invoices page joins into a line,
 * so the two surfaces cannot disagree about a number.
 */
function BalanceZone({ balance }: { balance: ClientBalance }) {
  const hasOverdue = balance.totalOverdueInvoices > 0;

  return (
    <Link className={`${styles.zone} ${styles.zonePrimary}`} href="/account/invoices">
      <span className={styles.zoneLabel}>Outstanding balance</span>

      {balance.currencies.length === 0 ? (
        <>
          <span className={styles.figure}>{formatCurrencyCents(0, "USD")}</span>
          <span className={styles.zoneNote}>You&rsquo;re all caught up.</span>
        </>
      ) : (
        balance.currencies.map((entry) => (
          <span key={entry.currency} className={styles.currencyBlock}>
            <span className={styles.currencyRow}>
              <span className={styles.figure} data-overdue={hasOverdue || undefined}>
                {formatCurrencyCents(entry.outstandingCents, entry.currency)}
              </span>
              {balance.isMultiCurrency ? (
                <em className={styles.currencyCode}>{entry.currency}</em>
              ) : null}
            </span>

            {/*
              * Stacked rather than joined, so the overdue count reads as its own
              * fact. Urgency colours that one line only — never the surface.
              */}
            <span className={styles.factList}>
              {currencyBalanceFacts(entry).map((fact, index) => (
                <span
                  key={fact}
                  className={styles.fact}
                  data-overdue={index > 0 && entry.overdueCount > 0 ? "" : undefined}
                >
                  {fact}
                </span>
              ))}
            </span>
          </span>
        ))
      )}

      <span className={styles.zoneAction}>
        View invoices
        <ArrowUpRight aria-hidden={true} />
      </span>
    </Link>
  );
}

/**
 * When money next moves.
 *
 * No timeline or progress rail: ClientNextBilling carries a service, a date and
 * an amount, and nothing about where the current period sits, so a rail would be
 * drawing a fact the platform does not hold.
 */
function NextBillingZone({
  nextBilling,
  activeSubscriptionCount,
}: {
  nextBilling: ClientNextBilling | null;
  activeSubscriptionCount: number;
}) {
  return (
    <Link className={styles.zone} href="/account/subscriptions">
      <span className={styles.zoneLabel}>Next billing</span>

      {nextBilling ? (
        <>
          <span className={styles.dateRow}>
            <CalendarDays className={styles.zoneIcon} aria-hidden={true} />
            <span className={styles.dateValue}>{nextBilling.dateLabel}</span>
          </span>
          <span className={styles.zoneNote}>{nextBilling.serviceName}</span>
          <span className={styles.zoneAmount}>{nextBilling.amountLabel}</span>
        </>
      ) : (
        <span className={styles.zoneState}>
          {activeSubscriptionCount === 0
            ? "You have no active subscriptions."
            : "No billing date is scheduled yet."}
        </span>
      )}

      <span className={styles.zoneAction}>
        View subscriptions
        <ArrowUpRight aria-hidden={true} />
      </span>
    </Link>
  );
}

/**
 * An abstract card outline.
 *
 * Carries no number, brand, expiry or logo — it is a shape standing for "a
 * payment method", which is why it is safe to show while none exists. Anything
 * resembling real card data is forbidden on this surface by
 * domain/client-portal/payment-method.ts.
 */
function CardSilhouette() {
  return (
    <svg
      className={styles.cardMark}
      viewBox="0 0 40 26"
      fill="none"
      aria-hidden={true}
      focusable="false"
    >
      <rect x="0.6" y="0.6" width="38.8" height="24.8" rx="3.4" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.6" y="6.4" width="38.8" height="4" fill="currentColor" opacity=".28" />
      <rect x="5" y="15.5" width="11" height="2.4" rx="1.2" fill="currentColor" opacity=".4" />
      <rect x="19" y="15.5" width="6" height="2.4" rx="1.2" fill="currentColor" opacity=".22" />
    </svg>
  );
}

/**
 * How this account pays.
 *
 * The list comes from `composeClientPaymentRails`, which always contains the
 * Wolf Forge Balance rail — so this zone reports the account's real payment
 * method and its real balance instead of the "No payment method on file" it
 * used to show, which was true only of card providers the portal never offered.
 *
 * The balance is the wallet's actual figure at every value, zero included: the
 * rail is the account's default whether or not there is money in it, and
 * blanking a zero would be the same untruth in a quieter form. Nothing about
 * PayPal or bank transfer is claimed here; those are stated on the Payment
 * method page with their real availability.
 */
function PaymentMethodZone({ rails }: { rails: ClientPaymentRail[] }) {
  const primary = primaryPaymentRail(rails);
  if (!primary) return null;

  return (
    <Link className={styles.zone} href="/account/payment-method">
      <span className={styles.zoneLabel}>Payment method</span>

      <span className={styles.cardRow}>
        <CardSilhouette />

        <span className={styles.cardCopy}>
          <span className={styles.zoneState}>{primary.label}</span>
          {primary.detail ? <span className={styles.zoneAmount}>{primary.detail}</span> : null}
          <span className={styles.zoneNote}>
            {primary.statusLabel ?? "Default payment method"}
          </span>
        </span>
      </span>

      <span className={styles.zoneAction}>
        Change payment method
        <ArrowUpRight aria-hidden={true} />
      </span>
    </Link>
  );
}

export function BillingStripSection({
  balance,
  nextBilling,
  activeSubscriptionCount,
  paymentRails,
}: {
  balance: ClientBalance | null;
  nextBilling: ClientNextBilling | null;
  /** Null means the Subscriptions module is denied, so that zone is omitted. */
  activeSubscriptionCount: number | null;
  /** Null when the account does not hold the Invoices module. */
  paymentRails: ClientPaymentRail[] | null;
}) {
  return (
    <section className={styles.section} aria-labelledby="portal-billing">
      <header className="portal-section-head">
        <h2 id="portal-billing">Billing</h2>
      </header>

      <div className={styles.billing}>
        {balance ? <BalanceZone balance={balance} /> : null}

        {activeSubscriptionCount !== null ? (
          <NextBillingZone
            nextBilling={nextBilling}
            activeSubscriptionCount={activeSubscriptionCount}
          />
        ) : null}

        {paymentRails ? <PaymentMethodZone rails={paymentRails} /> : null}
      </div>
    </section>
  );
}
