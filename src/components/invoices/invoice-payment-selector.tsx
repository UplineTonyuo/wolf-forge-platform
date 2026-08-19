"use client";

import { Check, ChevronDown, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { payInvoiceWithWfCardAction } from "../../app/actions/wf-card";
import { formatCurrencyCents } from "../../lib/format";
import { WolfForgeWalletCard } from "../clients/wolf-forge-wallet-card";

type Props = {
  invoiceId: string;
  holderName: string;
  invoiceBalanceCents: number;
  currency: string;
  walletBalanceCents: number;
  membershipStatus: "inactive" | "pending" | "active" | "cancelled";
  membershipPriceCents: number;
  membershipCurrency: string;
  collectible: boolean;
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


export function InvoicePaymentSelector({
  invoiceId,
  holderName,
  invoiceBalanceCents,
  currency,
  walletBalanceCents,
  membershipStatus,
  membershipPriceCents,
  membershipCurrency,
  collectible,
}: Props) {
  const modalTitleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "success"; walletBalanceCents: number }
    | { kind: "error"; message: string }
    | null
  >(null);

  const isMember = membershipStatus === "active";
  const enoughBalance = walletBalanceCents >= invoiceBalanceCents;
  const canPay = isMember && collectible && invoiceBalanceCents > 0 && enoughBalance;

  useEffect(() => {
    if (!membershipOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const returnFocusTarget = returnFocusRef.current;
    const dialog = modalRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMembershipOpen(false);
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("wf-modal-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("wf-modal-open");
      (returnFocusTarget ?? previouslyFocused)?.focus();
    };
  }, [membershipOpen]);

  function pay() {
    setResult(null);
    startTransition(async () => {
      const payment = await payInvoiceWithWfCardAction(invoiceId, requestId());
      if (payment.ok) {
        setResult({ kind: "success", walletBalanceCents: payment.walletBalanceCents });
        return;
      }
      if (payment.code === "MEMBERSHIP_REQUIRED") setMembershipOpen(true);
      setResult({ kind: "error", message: payment.error });
    });
  }

  return (
    <section className="invoice-payment-selector" aria-labelledby="payment-method-heading">
      <div className="invoice-payment-heading">
        <div>
          <span>PAYMENT METHOD</span>
          <h2 id="payment-method-heading">WF Card</h2>
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
            currency={currency}
            eyebrow="Your Wallet"
            compact
          />
          {!isMember ? (
            <button
              ref={returnFocusRef}
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
              <strong>WF Card</strong>
              <span>{isMember ? "Available balance" : "Locked"}</span>
            </div>
            {isMember ? <span className="invoice-selected-mark"><Check aria-hidden="true" /> Selected</span> : null}
          </div>

          {isMember ? (
            <strong className="invoice-payment-balance">
              {formatCurrencyCents(walletBalanceCents, currency)}
            </strong>
          ) : (
            <p>Unlock member-only offers, coupon eligibility, and future Wolf Forge benefits.</p>
          )}

          <dl className="invoice-payment-due">
            <dt>Invoice</dt>
            <dd>{formatCurrencyCents(invoiceBalanceCents, currency)}</dd>
          </dl>

          {isMember && collectible && !enoughBalance ? (
            <p className="invoice-payment-warning" role="status">
              Insufficient WF Card balance. Choose another payment method.
            </p>
          ) : null}

          {isMember ? (
            <button type="button" className="wf-pay-button" onClick={pay} disabled={!canPay || isPending}>
              {isPending
                ? "Processing securely..."
                : `Pay ${formatCurrencyCents(invoiceBalanceCents, currency)} with WF Card`}
            </button>
          ) : (
            <button
              ref={returnFocusRef}
              type="button"
              className="wf-pay-button"
              onClick={() => setMembershipOpen(true)}
            >
              Unlock WF Card
            </button>
          )}

          <button
            type="button"
            className="invoice-other-methods-toggle"
            aria-expanded={methodsOpen}
            aria-controls="future-payment-methods"
            onClick={() => setMethodsOpen((open) => !open)}
          >
            Other payment methods <ChevronDown aria-hidden="true" />
          </button>
          {methodsOpen ? (
            <div id="future-payment-methods" className="invoice-future-methods">
              <strong>No additional online methods are enabled yet.</strong>
              <span>Future providers will appear here after secure server settlement is integrated.</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {result?.kind === "success" ? "Invoice paid successfully with WF Card." : result?.kind === "error" ? result.message : ""}
      </div>
      {result?.kind === "success" ? (
        <div className="wf-payment-confirmation" role="status">
          <Check aria-hidden="true" />
          <div>
            <strong>Invoice paid with WF Card</strong>
            <span>Available balance {formatCurrencyCents(result.walletBalanceCents, currency)}</span>
          </div>
        </div>
      ) : null}
      {result?.kind === "error" ? <p className="invoice-payment-error" role="alert">{result.message}</p> : null}

      {membershipOpen ? (
        <div className="wf-membership-modal" role="presentation">
          <button className="wf-membership-backdrop" type="button" aria-label="Close membership information" onClick={() => setMembershipOpen(false)} />
          <div ref={modalRef} className="wf-membership-dialog" role="dialog" aria-modal="true" aria-labelledby={modalTitleId}>
            <button type="button" className="wf-membership-close" onClick={() => setMembershipOpen(false)} aria-label="Close">
              <X aria-hidden="true" />
            </button>
            <span className="wf-membership-eyebrow">WF CARD</span>
            <h2 id={modalTitleId}>Wolf Forge Membership</h2>
            <strong className="wf-membership-price">
              {formatMembershipPrice(membershipPriceCents, membershipCurrency)} <span>one-time</span>
            </strong>
            <p>Unlock:</p>
            <ul>
              <li>WF Card wallet</li>
              <li>Member-only offers</li>
              <li>Cashback opportunities</li>
              <li>Exclusive coupon eligibility</li>
              <li>Future Wolf Forge member benefits</li>
            </ul>
            {checkoutNotice ? (
              <div className="wf-checkout-boundary" role="status">
                Secure membership checkout requires the upcoming payment-provider integration. Your membership has not been activated.
              </div>
            ) : null}
            <button type="button" className="wf-membership-primary" onClick={() => setCheckoutNotice(true)}>
              Get WF Card {"\u2014"} {formatMembershipPrice(membershipPriceCents, membershipCurrency)}
            </button>
            <button type="button" className="wf-membership-secondary" onClick={() => setMembershipOpen(false)}>Not now</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
