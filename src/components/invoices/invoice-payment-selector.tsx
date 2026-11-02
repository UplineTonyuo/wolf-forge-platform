"use client";

import {
  BellRing,
  Check,
  CircleDollarSign,
  Landmark,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { payInvoiceWithWfCardAction } from "../../app/actions/wf-card";
import {
  composeInvoiceSettlementPlan,
  type InvoiceSettlementPlan,
} from "../../domain/payments/invoice-settlement";
import type { ClientPaymentRail, PaymentRailId } from "../../domain/payments/payment-rails";
import { formatCurrencyCents } from "../../lib/format";
import { PortalDialog } from "../account/ui/portal-dialog";
import { WolfForgeWalletCard } from "../clients/wolf-forge-wallet-card";
import styles from "./invoice-split-payment.module.css";

type Props = {
  invoiceId: string;
  holderName: string;
  invoiceBalanceCents: number;
  currency: string;
  walletBalanceCents: number;
  /** The wallet's own currency. A mismatch means it cannot be applied at all. */
  walletCurrency: string;
  membershipStatus: "inactive" | "pending" | "active" | "cancelled";
  membershipPriceCents: number;
  membershipCurrency: string;
  collectible: boolean;
  /** Composed server-side; the external rails carry their real availability. */
  paymentRails: ClientPaymentRail[];
  manualAvailable?: boolean;
  manualPending?: boolean;
};

function requestId() {
  return crypto.randomUUID();
}

function formatMembershipPrice(cents: number, currency: string) {
  const showCents = cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

const railIcons: Record<string, typeof Landmark> = {
  paypal: CircleDollarSign,
  bank_transfer: Landmark,
};

/**
 * Balance first, then the rest.
 *
 * The settled rule: an invoice larger than the Wolf Forge Balance applies the
 * balance and leaves a remainder for an external rail. $780 against $500 is
 * $500 + $280.
 *
 * The arithmetic is `composeInvoiceSettlementPlan` in the domain and is not
 * repeated here. What this component adds is the honesty about *execution*:
 * `app_pay_invoice_with_wallet` takes no amount and refuses a wallet that
 * cannot cover the invoice in full, and no external rail is connected to
 * collect a remainder. So the breakdown is shown as what is owed and how it
 * splits — and the pay button appears only when `plan.executableNow`, which
 * today means a full wallet settlement. Nothing here marks an invoice paid that
 * the ledger has not recorded.
 */
function PaymentBreakdown({ plan }: { plan: InvoiceSettlementPlan }) {
  return (
    <dl className={styles.breakdown}>
      <div className={styles.row}>
        <dt>Invoice total</dt>
        <dd>{formatCurrencyCents(plan.invoiceDueCents, plan.currency)}</dd>
      </div>

      {/*
        * Shown only when the balance genuinely contributes. A "-$0.00" line on
        * an account with no membership or an empty wallet is noise pretending
        * to be a calculation; the reason is stated below instead.
        */}
      {plan.walletAppliedCents > 0 ? (
        <div className={styles.row} data-applied="true">
          <dt>Wolf Forge Balance applied</dt>
          <dd>−{formatCurrencyCents(plan.walletAppliedCents, plan.currency)}</dd>
        </div>
      ) : null}

      <div className={styles.row} data-total="true">
        <dt>{plan.fullyCoveredByWallet ? "Remaining due" : "Remaining due externally"}</dt>
        <dd>{formatCurrencyCents(plan.remainingCents, plan.currency)}</dd>
      </div>
    </dl>
  );
}

/**
 * How the remainder would be paid.
 *
 * Only ever about the remainder — the wallet portion is already accounted for
 * above, so these rails are never offered for the full invoice when a balance
 * applies. An unconnected rail is listed with its real state and cannot be
 * selected, which is the same rule the Payment method page enforces.
 */
function RemainderRails({
  rails,
  remainingCents,
  currency,
}: {
  rails: ClientPaymentRail[];
  remainingCents: number;
  currency: string;
}) {
  const [selected, setSelected] = useState<PaymentRailId | null>(null);
  const anyAvailable = rails.some((rail) => rail.isAvailable);

  return (
    <div className={styles.remainder}>
      <span className={styles.remainderLabel}>
        Choose how to pay the remaining {formatCurrencyCents(remainingCents, currency)}
      </span>

      <fieldset className={styles.rails}>
        <legend className={styles.srOnly}>External payment method</legend>

        {rails.map((rail) => {
          const Icon = railIcons[rail.id] ?? Landmark;

          return (
            <label
              key={rail.id}
              className={styles.rail}
              data-available={rail.isAvailable}
              data-selected={rail.id === selected}
            >
              <input
                className={styles.railInput}
                type="radio"
                name="invoice-remainder-rail"
                value={rail.id}
                checked={rail.id === selected}
                disabled={!rail.isAvailable}
                /*
                 * Guarded as well as disabled: an unavailable rail must not
                 * become the selection by any route, including a programmatic
                 * event.
                 */
                onChange={() => {
                  if (!rail.isAvailable) return;
                  setSelected(rail.id);
                }}
              />

              <span className={styles.railMark}>
                <Icon aria-hidden={true} />
              </span>

              <span className={styles.railText}>
                <span className={styles.railLabel}>{rail.label}</span>
                <span className={styles.railDesc}>{rail.description}</span>
              </span>

              {rail.statusLabel ? (
                <span className={styles.railStatus}>{rail.statusLabel}</span>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      {/*
        * The whole truth, stated once. Selecting a rail today changes nothing
        * and completes nothing, and the surface says so rather than presenting
        * a pay button that would have to fail.
        */}
      <p className={styles.remainderNote} role="status">
        {anyAvailable
          ? "Selecting a method here does not complete the payment yet — Wolf Forge will confirm the remaining amount with you."
          : "Wolf Forge has not connected an external payment method yet, so this remaining amount cannot be paid online. Message us and we will settle it with you directly."}
      </p>
    </div>
  );
}

export function InvoicePaymentSelector({
  invoiceId,
  holderName,
  invoiceBalanceCents,
  currency,
  walletBalanceCents,
  walletCurrency,
  membershipStatus,
  membershipPriceCents,
  membershipCurrency,
  collectible,
  paymentRails,
  manualAvailable = false,
  manualPending = false,
}: Props) {
  const router = useRouter();
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "success"; walletBalanceCents: number }
    | { kind: "error"; message: string }
    | null
  >(null);

  const isMember = membershipStatus === "active";
  const externalRails = paymentRails.filter((rail) => rail.id !== "wf_balance");

  const plan = composeInvoiceSettlementPlan({
    invoiceDueCents: invoiceBalanceCents,
    currency,
    walletBalanceCents,
    walletCurrency,
    membershipStatus,
    collectible,
    externalRailStatuses: externalRails.map((rail) => rail.status),
  });

  function pay() {
    setResult(null);
    startTransition(async () => {
      const payment = await payInvoiceWithWfCardAction(invoiceId, requestId());
      if (payment.ok) {
        setResult({ kind: "success", walletBalanceCents: payment.walletBalanceCents });
        router.refresh();
        return;
      }
      if (payment.code === "MEMBERSHIP_REQUIRED") setMembershipOpen(true);
      setResult({ kind: "error", message: payment.error });
    });
  }

  if (manualPending) return null;

  return (
    <section className="invoice-payment-selector" aria-labelledby="payment-method-heading">
      <div className="invoice-payment-heading">
        <div>
          <span>PAYMENT METHOD</span>
          <h2 id="payment-method-heading">Wolf Forge Balance</h2>
        </div>
        {isMember ? <span className="wf-member-state"><ShieldCheck aria-hidden="true" /> Member benefits active</span> : null}
      </div>

      <div className={`invoice-payment-choice${isMember ? " is-selected" : " is-locked"}`}>
        <div className="invoice-payment-card-wrap">
          {/*
            This selector only ever renders on the client invoice page, so the
            card is addressing the account holder directly. Admin surfaces keep
            the component's default "Client Wallet" wording.
          */}
          <WolfForgeWalletCard
            clientName={holderName}
            balanceCents={walletBalanceCents}
            currency={walletCurrency}
            eyebrow="Your Wallet"
            compact
          />
          {!isMember ? (
            <button
              type="button"
              className="wf-card-lock"
              onClick={() => setMembershipOpen(true)}
              aria-label="Unlock WF Card membership benefits"
            >
              <span><LockKeyhole aria-hidden="true" /> Members only</span>
              <strong>Unlock payment benefits</strong>
            </button>
          ) : null}
        </div>

        <div className="invoice-payment-summary">
          <div className="invoice-payment-selected-row">
            <div>
              <strong>Wolf Forge Balance</strong>
              <span>{isMember ? "Available balance" : "Locked"}</span>
            </div>
            {isMember ? <span className="invoice-selected-mark"><Check aria-hidden="true" /> Selected</span> : null}
          </div>

          {isMember ? (
            <strong className="invoice-payment-balance">
              {formatCurrencyCents(walletBalanceCents, walletCurrency)}
            </strong>
          ) : (
            <p>Unlock member-only offers, coupon eligibility, and future Wolf Forge benefits.</p>
          )}

          {manualAvailable ? <p className={styles.blockerNote}>Pay the full invoice with your available balance, or use manual payment below. No partial wallet payment has been deducted.</p> : <><span className={styles.breakdownLabel}>Payment breakdown</span><PaymentBreakdown plan={plan} /></>}

          {/*
            * Why the balance contributed nothing, when it did not. Stated in
            * the client's own terms and only for the reason that is actually
            * true — the same order the RPC checks them in.
            */}
          {plan.walletAppliedCents === 0 && plan.walletBlocker !== null && collectible ? (
            <p className={styles.blockerNote} role="status">
              {plan.walletBlocker === "membership_required"
                ? "An active WF Card membership is required before your balance can be applied."
                : plan.walletBlocker === "currency_mismatch"
                  ? `Your balance is held in ${walletCurrency} and this invoice is in ${currency}, so it cannot be applied.`
                  : "Your Wolf Forge Balance is $0.00, so the full amount is due externally."}
            </p>
          ) : null}

          {plan.executableNow ? (
            <button type="button" className="wf-pay-button" onClick={pay} aria-busy={isPending || undefined} disabled={isPending}>
              {isPending
                ? "Processing securely..."
                : `Pay ${formatCurrencyCents(plan.walletAppliedCents, plan.currency)} with Wolf Forge Balance`}
            </button>
          ) : null}

          {!isMember ? (
            <button
              type="button"
              className="wf-pay-button"
              onClick={() => setMembershipOpen(true)}
            >
              Unlock WF Card
            </button>
          ) : null}

          {/*
            * The invoice is settled or not open: no breakdown action belongs
            * here, and the totals above already state the position.
            */}
          {collectible && plan.remainingCents > 0 && !manualAvailable ? (
            <RemainderRails
              rails={externalRails}
              remainingCents={plan.remainingCents}
              currency={plan.currency}
            />
          ) : null}

          {collectible && plan.fullyCoveredByWallet ? (
            <p className={styles.coveredNote}>
              Your Wolf Forge Balance covers this invoice in full. No external payment is
              required.
            </p>
          ) : null}
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {result?.kind === "success" ? "Invoice paid successfully with Wolf Forge Balance." : result?.kind === "error" ? result.message : ""}
      </div>
      {result?.kind === "success" ? (
        <div className="wf-payment-confirmation" role="status">
          <Check aria-hidden="true" />
          <div>
            <strong>Invoice paid with Wolf Forge Balance</strong>
            <span>Available balance {formatCurrencyCents(result.walletBalanceCents, walletCurrency)}</span>
          </div>
        </div>
      ) : null}
      {result?.kind === "error" ? <p className="invoice-payment-error" role="alert">{result.message}</p> : null}

      {/*
        * The shared portal dialog, not a local overlay.
        *
        * THE BUG THIS FIXES. `.portal-main-inner > *` carries
        * `animation: portal-page-enter … both`, and that animation's `to`
        * keyframe sets `transform: none`. With `fill-mode: both` the animation
        * keeps applying forever, and the *computed* value lands as
        * `matrix(1, 0, 0, 1, 0, 0)` — an identity transform, but not the
        * keyword `none`. Any transform other than `none` makes the element a
        * containing block for `position: fixed` descendants.
        *
        * So while this modal rendered inline, its `position: fixed; inset: 0`
        * backdrop resolved against the invoice <article> box rather than the
        * viewport, leaving the page edges undimmed. Measured, not guessed:
        * backdrop 960x1936 at x=704 inside a 2133x987 viewport.
        *
        * Raising z-index would not have touched it — the problem was
        * containment, not stacking. PortalDialog renders through
        * createPortal(…, document.body), which lifts the node out of that
        * subtree entirely, and brings the platform's scroll lock, focus trap,
        * focus return, Escape and reduced-motion handling with it. That is why
        * the cart and New message dialogs never had this bug.
        */}
      <PortalDialog
        open={membershipOpen}
        onClose={() => setMembershipOpen(false)}
        title="Wolf Forge Membership"
        description="WF Card"
        showClose={true}
      >
        {/*
          * A preview, not a checkout.
          *
          * There is no write path for wf_card_memberships anywhere in the
          * platform — no RPC, no service, no action — so membership cannot be
          * purchased or activated by any client action. The old dialog offered
          * "Get WF Card — $259" and then explained after the click that nothing
          * had happened, which is a checkout that fails on purpose. This states
          * the position before the click instead.
          */}
        <span className={styles.membershipState}>Membership opens soon</span>

        <strong className={styles.membershipPrice}>
          {formatMembershipPrice(membershipPriceCents, membershipCurrency)}
          <span>one-time</span>
        </strong>

        <p className={styles.membershipListLabel}>What membership will unlock:</p>
        <ul className={styles.membershipList}>
          <li>Wolf Forge Balance for instant invoice settlement</li>
          <li>Member-only offers</li>
          <li>Cashback opportunities</li>
          <li>Exclusive coupon eligibility</li>
          <li>Future Wolf Forge member benefits</li>
        </ul>

        <p className={styles.membershipTruth}>
          Membership is not open for purchase yet. The price above is confirmed; when
          checkout opens you will be able to activate it here.
        </p>

        {/*
          * A link to something that genuinely works, rather than a "Notify me"
          * button with nothing behind it. There is no waitlist table and no
          * notification registration for membership, so a button claiming to
          * record interest would be the same fiction in a friendlier voice. The
          * composer is real and reaches a person.
          *
          * Both controls sit in one row that owns its own spacing. Previously
          * the CTA was an <a> wearing `.wf-membership-primary`, a rule written
          * for a <button>: it sets min-height but no display, and min-height
          * does not apply to a non-replaced inline box, so the anchor collapsed
          * to its line box and left the gap under the CTA.
          */}
        <div className={styles.membershipActions}>
          <Link
            className={styles.membershipCta}
            href="/account/messages?compose=1"
            onClick={() => setMembershipOpen(false)}
          >
            <BellRing aria-hidden={true} />
            Ask about membership
          </Link>

          <button
            type="button"
            className={styles.membershipDismiss}
            onClick={() => setMembershipOpen(false)}
          >
            Close
          </button>
        </div>
      </PortalDialog>

    </section>
  );
}
