import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientPaymentMethodView } from "../../../components/account/billing/client-payment-method";
import { FinancialVisibilityBoundary } from "../../../components/invoices/financial-visibility-boundary";
import { walletVisibility, financialAuthority, financialIdentity } from "../../../domain/invoices/visibility";
import styles from "../../../components/account/billing/payment-rails.module.css";
import { formatCurrencyCents, formatDateTime } from "../../../lib/format";
import { resolveWalletFunding } from "../../../domain/client-portal/payment-method";
import { composeClientPaymentRails } from "../../../domain/payments/payment-rails";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readExternalPaymentRailAvailability } from "../../../lib/payments/payment-rail-configuration";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Payment method" };

export default async function ClientPaymentMethodPage() {
  const context = await getClientContext();

  let denied = false;
  let loadError: string | null = null;
  let wallet = null;
  let membership = null;
  let history: Awaited<ReturnType<typeof context.services.wallets.listMyHistory>> = [];
  let workEnabled = false;

  try {
    /*
     * This page reads the account's own funding state, which is part of its
     * billing surface, so it rides the portal_invoices grant rather than
     * inventing a module key the database does not know about. The wallet read
     * is company-scoped by RLS on public.company_wallets; the company id comes
     * from app_get_client_account_context, never from the browser.
     */
    await context.services.permissions.requireModuleAccess("portal_invoices");
    [wallet, membership, history, workEnabled] = await Promise.all([
      context.services.wallets.getForCompany(context.user.companyId),
      context.services.wfCard.getMembership(context.user.companyId),
      context.services.wallets.listMyHistory(),
      context.services.invoices.workEnabled(),
    ]);
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Payment settings could not be loaded.";
  }

  if (denied) redirect("/account");

  if (loadError || !wallet) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Payment method</h1>
        </header>
        <p className="portal-empty">{loadError ?? "Payment settings could not be loaded."}</p>
      </div>
    );
  }

  const funding = resolveWalletFunding({
    membershipStatus: membership?.status ?? null,
    balanceCents: wallet.balance_cents,
    currency: wallet.currency,
  });

  /*
   * The rails are composed on the server from two facts the browser has no part
   * in: the wallet row RLS allowed this session to read, and whether Wolf Forge
   * has connected PayPal or bank transfer.
   *
   * readExternalPaymentRailAvailability() lives in a `server-only` module and
   * returns two enum strings. No credential, variable name or partial
   * configuration state crosses to the client — a client learns only what this
   * page tells them out loud, which is that neither is connected yet.
   */
  const signature = walletVisibility(wallet, history, workEnabled, membership?.status ?? null, financialIdentity(context.user));
  return (
    <FinancialVisibilityBoundary key={financialAuthority("wallet", signature)} signature={signature} scope="wallet">
    <ClientPaymentMethodView
      rails={composeClientPaymentRails({
        wallet: funding,
        availability: readExternalPaymentRailAvailability(),
      })}
      wallet={funding}
      holderName={context.user.displayName ?? context.user.companyName}
      workEnabled={workEnabled}
    />
    <section className="portal-page portal-section" aria-labelledby="wallet-history-heading">
      <h2 id="wallet-history-heading">Wallet history</h2>
      <p className="portal-note">Your latest recorded wallet transactions. Refund ledger entries do not automatically credit this balance.</p>
      {history.length === 0 ? <p className="portal-empty">No wallet transactions recorded.</p> : <ol className={styles.walletHistory}>{history.map((entry) => <li key={entry.id}>
        <div><strong>{entry.source.replaceAll("_", " ")}</strong>{entry.reason ? <p>{entry.reason}</p> : null}<small>{formatDateTime(entry.created_at)}</small></div>
        <div><strong>{formatCurrencyCents(entry.amount_cents, entry.currency)}</strong><small>Balance {formatCurrencyCents(entry.balance_after_cents, entry.currency)}</small></div>
      </li>)}</ol>}
    </section>
    </FinancialVisibilityBoundary>
  );
}
