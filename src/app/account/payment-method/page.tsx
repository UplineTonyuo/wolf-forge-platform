import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientPaymentMethodView } from "../../../components/account/billing/client-payment-method";
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

  try {
    /*
     * This page reads the account's own funding state, which is part of its
     * billing surface, so it rides the portal_invoices grant rather than
     * inventing a module key the database does not know about. The wallet read
     * is company-scoped by RLS on public.company_wallets; the company id comes
     * from app_get_client_account_context, never from the browser.
     */
    await context.services.permissions.requireModuleAccess("portal_invoices");
    [wallet, membership] = await Promise.all([
      context.services.wallets.getForCompany(context.user.companyId),
      context.services.wfCard.getMembership(context.user.companyId),
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
          <span className="portal-eyebrow">Billing</span>
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
  return (
    <ClientPaymentMethodView
      rails={composeClientPaymentRails({
        wallet: funding,
        availability: readExternalPaymentRailAvailability(),
      })}
      wallet={funding}
      holderName={context.user.displayName ?? context.user.companyName}
    />
  );
}
