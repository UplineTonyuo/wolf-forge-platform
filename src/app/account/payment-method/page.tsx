import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientPaymentMethodView } from "../../../components/account/billing/client-payment-method";
import {
  resolvePaymentMethodState,
  resolveWalletFunding,
} from "../../../domain/client-portal/payment-method";
import { toClientSafeError } from "../../../lib/errors/application-error";
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

  return (
    <ClientPaymentMethodView
      /*
       * No arguments: the state resolves from the connected-provider list,
       * which is empty. "No payment method on file" is therefore a derived
       * result rather than fixed copy someone could forget to remove once a
       * provider is integrated.
       */
      state={resolvePaymentMethodState()}
      wallet={resolveWalletFunding({
        membershipStatus: membership?.status ?? null,
        balanceCents: wallet.balance_cents,
        currency: wallet.currency,
      })}
      holderName={context.user.displayName ?? context.user.companyName}
    />
  );
}
