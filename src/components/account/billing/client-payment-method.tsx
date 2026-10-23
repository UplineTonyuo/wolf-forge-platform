import { BadgeCheck, CircleDollarSign, Info, Landmark } from "lucide-react";
import Link from "next/link";
import type { WalletFundingState } from "../../../domain/client-portal/payment-method";
import {
  alternativePaymentRails,
  primaryPaymentRail,
  type ClientPaymentRail,
  type PaymentRailId,
} from "../../../domain/payments/payment-rails";
import { formatCurrencyCents } from "../../../lib/format";
import { WolfForgeWalletCard } from "../../clients/wolf-forge-wallet-card";
import { PaymentRailSwitcher } from "./payment-rail-switcher";
import styles from "./payment-rails.module.css";

/**
 * How this account pays Wolf Forge.
 *
 * Three rails, in a deliberate hierarchy rather than an equal grid:
 *
 *   Wolf Forge Balance   real, default, and the anchor of the page. Shown with
 *                        the account's actual wallet balance — including
 *                        $0.00 — and its actual membership state.
 *   PayPal               intended, not connected. Stated as such.
 *   Bank Transfer        intended, not configured. Stated as such.
 *
 * Everything on this page is a fact the server computed. The rails arrive
 * already resolved from `composeClientPaymentRails`, whose availability comes
 * from `readExternalPaymentRailAvailability()` in a `server-only` module, so no
 * component here can decide that a provider is connected and no browser can
 * claim it is.
 *
 * WHAT MUST NEVER APPEAR HERE, in addition to the card rules inherited from
 * domain/client-portal/payment-method.ts: no bank account number, IBAN, routing
 * number, sort code or beneficiary name, and no PayPal account, email or
 * merchant id. Wolf Forge holds none of those, so any that appeared would have
 * been invented. `ClientPaymentRail` has no field that could carry one.
 *
 * Stripe is not represented. The Stripe Phase 1 mapping has no client surface
 * and is parked; offering "Card" would advertise a capability that does not
 * exist.
 */

const railIcons: Record<PaymentRailId, typeof Landmark> = {
  wf_balance: BadgeCheck,
  /*
   * Generic marks on purpose. A PayPal logo would assert a relationship that
   * has not been established, and brand assets are not ours to ship.
   */
  paypal: CircleDollarSign,
  bank_transfer: Landmark,
};

function AlternativeRail({ rail }: { rail: ClientPaymentRail }) {
  const Icon = railIcons[rail.id];

  return (
    <li className={styles.rail} data-available={rail.isAvailable}>
      <span className={styles.railMark}>
        <Icon aria-hidden={true} />
      </span>

      <span className={styles.railText}>
        <span className={styles.railLabel}>{rail.label}</span>
        <span className={styles.railDesc}>{rail.description}</span>
      </span>

      {/*
        * The truthful state, and the only trailing content. There is nothing
        * else to show: an unconnected rail has no account, no instrument and no
        * detail behind it.
        */}
      <span className={styles.railStatus}>{rail.statusLabel ?? "Available"}</span>
    </li>
  );
}

export function ClientPaymentMethodView({
  rails,
  wallet,
  holderName,
  workEnabled = true,
}: {
  rails: ClientPaymentRail[];
  wallet: WalletFundingState;
  holderName: string;
  workEnabled?: boolean;
}) {
  const primary = primaryPaymentRail(rails);
  const alternatives = alternativePaymentRails(rails);

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Payment method</h1>
        <p>{workEnabled ? "How your account settles invoices with Wolf Forge." : "Invoices is disabled. Your wallet balance and history remain available; new Invoice payments and purchases are unavailable."}</p>
      </header>

      <div className={styles.stack}>
        {primary ? (
          <section className="portal-section" aria-labelledby="portal-default-rail">
            <article className={styles.anchor} data-status={primary.status}>
              <div className={styles.anchorVisual}>
                {/* Client POV: the account holder is "you", never "Client". */}
                <WolfForgeWalletCard
                  clientName={holderName}
                  balanceCents={wallet.balanceCents}
                  currency={wallet.currency}
                  eyebrow="Your Wallet"
                  compact
                />
              </div>

              <div className={styles.anchorBody}>
                <div className={styles.anchorHead}>
                  <h2 className={styles.anchorTitle} id="portal-default-rail">
                    {primary.label}
                  </h2>
                  <span className={styles.defaultChip}>
                    <BadgeCheck aria-hidden={true} />
                    Default
                  </span>
                </div>

                {/*
                  * The real figure, split typographically rather than derived a
                  * second way: both this and the rail's own `detail` read the
                  * same wallet, so the page and the Dashboard cannot disagree.
                  * A zero balance renders as $0.00 — the rail is still this
                  * account's payment method.
                  */}
                <p className={styles.figureRow}>
                  <span className={styles.figure}>
                    {formatCurrencyCents(wallet.balanceCents, wallet.currency)}
                  </span>
                  <span className={styles.figureUnit}>{workEnabled ? "available" : "recorded balance"}</span>
                </p>

                <p className={styles.anchorCopy}>{workEnabled ? primary.description : "Your recorded wallet balance remains yours. New Invoice payments require Invoices to be re-enabled."}</p>

                {workEnabled && !primary.isAvailable ? (
                  <p className={styles.anchorNotice}>
                    <Info aria-hidden={true} />
                    <span>
                      WF Card membership unlocks wallet payments, member-only offers and coupon eligibility. You can activate it from an open invoice.
                    </span>
                  </p>
                ) : null}

                <div className={styles.anchorActions}>
                  {workEnabled ? <PaymentRailSwitcher rails={rails} /> : null}
                  <Link className="portal-secondary-action" href="/account/invoices">
                    Go to invoices
                  </Link>
                </div>
              </div>
            </article>
          </section>
        ) : null}

        <section className="portal-section" aria-labelledby="portal-other-rails">
          <div className={styles.groupHead}>
            <h2 className={styles.groupLabel} id="portal-other-rails">
              Other payment methods
            </h2>
            <p className={styles.groupNote}>
              {workEnabled ? "Wolf Forge is preparing these. They will become selectable here once they are connected." : "New payment-method selection is unavailable while Invoices is disabled."}
            </p>
          </div>

          <ul className={styles.rails}>
            {alternatives.map((rail) => (
              <AlternativeRail key={rail.id} rail={rail} />
            ))}
          </ul>
        </section>
      </div>

      <p className="portal-note">
        Wolf Forge will never ask for your full card number, bank credentials or a security code
        by email or message.
      </p>
    </div>
  );
}
