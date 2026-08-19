import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type {
  PaymentMethodState,
  WalletFundingState,
} from "../../../domain/client-portal/payment-method";
import { formatCurrencyCents } from "../../../lib/format";
import { WolfForgeWalletCard } from "../../clients/wolf-forge-wallet-card";

/**
 * How this account can pay Wolf Forge.
 *
 * Two funding sources, presented honestly:
 *
 *   WF Card wallet   real. An internal balance, settled by
 *                    app_pay_invoice_with_wf_card. Shown with the account's
 *                    actual balance and membership state.
 *
 *   Card / online    does not exist. No Stripe, no PayPal, no stored card.
 *                    The state is computed in
 *                    domain/client-portal/payment-method.ts from the connected
 *                    provider list, which is empty — so this screen cannot show
 *                    a brand, a last four or an expiry no matter what.
 */
export function ClientPaymentMethodView({
  state,
  wallet,
  holderName,
}: {
  state: PaymentMethodState;
  wallet: WalletFundingState;
  holderName: string;
}) {
  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <span className="portal-eyebrow">Billing</span>
        <h1>Payment method</h1>
        <p>How your account settles invoices with Wolf Forge.</p>
      </header>

      <section className="portal-section" aria-labelledby="portal-wallet-method">
        <header className="portal-section-head">
          <h2 id="portal-wallet-method">WF Card</h2>
        </header>

        <div className="portal-method-card">
          <div className="portal-method-visual">
            {/* Client POV: the account holder is "you", never "Client". */}
            <WolfForgeWalletCard
              clientName={holderName}
              balanceCents={wallet.balanceCents}
              currency={wallet.currency}
              eyebrow="Your Wallet"
              compact
            />
          </div>

          <div className="portal-method-body">
            {wallet.canSettleInvoices ? (
              <>
                <span className="portal-method-state">
                  <ShieldCheck aria-hidden={true} />
                  Active
                </span>
                <strong className="portal-billing-figure">
                  {formatCurrencyCents(wallet.balanceCents, wallet.currency)}
                </strong>
                <span className="portal-billing-note">
                  Available balance. Use it to settle any invoice from its page.
                </span>
              </>
            ) : (
              <>
                <span className="portal-method-state" data-inactive="true">
                  Not active
                </span>
                <span className="portal-billing-note">
                  WF Card membership unlocks the wallet, member-only offers and coupon eligibility.
                  You can activate it from any open invoice.
                </span>
              </>
            )}

            <Link className="portal-secondary-action" href="/account/invoices">
              Go to invoices
            </Link>
          </div>
        </div>
      </section>

      <section className="portal-section" aria-labelledby="portal-online-method">
        <header className="portal-section-head">
          <h2 id="portal-online-method">Card and online payments</h2>
        </header>

        <div className="portal-card">
          {state.kind === "no_provider" ? (
            <>
              <strong className="portal-billing-figure is-secondary">
                No payment method on file
              </strong>
              <p>
                Wolf Forge has not connected online card payments to your account yet. When we do,
                you&rsquo;ll be able to save a payment method here and pay invoices directly.
              </p>
              <p className="portal-note">
                Wolf Forge will never ask for your full card number or security code by email or
                message.
              </p>
            </>
          ) : state.kind === "provider_no_method" ? (
            <>
              <strong className="portal-billing-figure is-secondary">
                No payment method saved
              </strong>
              <p>Add a payment method to settle invoices online.</p>
            </>
          ) : (
            <>
              <div className="portal-stored-method" data-attention={state.kind}>
                <strong>
                  {state.method.brand} •••• {state.method.last4}
                </strong>
                <span>
                  Expires {String(state.method.expiryMonth).padStart(2, "0")}/
                  {String(state.method.expiryYear).slice(-2)}
                </span>
                <em>Default</em>
              </div>

              {state.kind === "needs_attention" ? (
                <div className="portal-callout" data-tone="payment_due">
                  <strong>This payment method needs attention.</strong>
                  <span>It has expired, so invoices cannot be charged to it.</span>
                </div>
              ) : null}

              {state.others.length > 0 ? (
                <p className="portal-note">
                  {state.others.length} other saved{" "}
                  {state.others.length === 1 ? "method" : "methods"}.
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
