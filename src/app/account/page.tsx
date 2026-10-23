import type { Metadata } from "next";
import { ClientDashboard } from "../../components/account/dashboard/client-dashboard";
import { FinancialVisibilityBoundary } from "../../components/invoices/financial-visibility-boundary";
import { invoiceFundingVisibility, financialAuthority, financialIdentity } from "../../domain/invoices/visibility";
import {
  getClientPortalSummary,
  readClientPaymentRails,
  readClientInvoices,
} from "../../lib/supabase/client-portal-data";
import { getClientContext } from "../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function ClientDashboardPage() {
  const [context, summary, paymentRails] = await Promise.all([
    getClientContext(),
    getClientPortalSummary(),
    readClientPaymentRails(),
  ]);

  /*
   * The reads behind the summary are module-gated and memoized for the request,
   * so the rail above this page and the page itself share one set of queries. A
   * module the account does not hold produced null upstream and its section is
   * absent here rather than empty.
   *
   * Payment rails are read the same way and on the same grant as the balance,
   * so the Billing strip cannot show a figure it has no payment method for, or
   * a payment method for an account that cannot see its invoices. The Wolf
   * Forge Balance rail is always present in that list — including at a zero
   * balance — which is why this surface no longer claims the account has no
   * payment method on file.
   */
  const dashboard = (
    <ClientDashboard
      companyName={context.user.companyName}
      displayName={context.user.displayName}
      summary={summary}
      paymentRails={paymentRails}
      storeGranted={context.user.modules.portal_store === true}
    />
  );
  if (!context.user.modules.portal_invoices) return dashboard;
  const [rows, enabled, wallet, membership] = await Promise.all([
    readClientInvoices(), context.services.invoices.workEnabled(),
    context.services.wallets.getForCompany(context.user.companyId),
    context.services.wfCard.getMembership(context.user.companyId),
  ]);
  const signature = invoiceFundingVisibility(rows ?? [], enabled, wallet, membership?.status ?? null, financialIdentity(context.user));
  return <FinancialVisibilityBoundary key={financialAuthority("dashboard", signature)} signature={signature} scope="dashboard">{dashboard}</FinancialVisibilityBoundary>;
}
