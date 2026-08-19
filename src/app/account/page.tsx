import type { Metadata } from "next";
import { ClientDashboard } from "../../components/account/dashboard/client-dashboard";
import { resolvePaymentMethodState } from "../../domain/client-portal/payment-method";
import { getClientPortalSummary } from "../../lib/supabase/client-portal-data";
import { getClientContext } from "../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function ClientDashboardPage() {
  const [context, summary] = await Promise.all([getClientContext(), getClientPortalSummary()]);

  /*
   * The reads behind the summary are module-gated and memoized for the request,
   * so the rail above this page and the page itself share one set of queries. A
   * module the account does not hold produced null upstream and its section is
   * absent here rather than empty.
   *
   * Payment method state is computed with no arguments: it resolves from the
   * connected-provider list, which is empty, so the dashboard reports "no
   * payment method on file" as a derived fact rather than as fixed copy.
   */
  return (
    <ClientDashboard
      companyName={context.user.companyName}
      displayName={context.user.displayName}
      summary={summary}
      paymentMethod={resolvePaymentMethodState()}
      storeGranted={context.user.modules.portal_store === true}
    />
  );
}
