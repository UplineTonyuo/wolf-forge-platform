import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientReportingView } from "../../../components/account/reporting/client-reporting";
import {
  toClientReportViews,
  type ClientReportView,
} from "../../../domain/reporting/projections";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Reporting" };

/**
 * The client's reporting history.
 *
 * app_list_my_client_reports resolves the company from auth.uid() and gates on
 * the portal_reporting module, so this page has no company identifier to get
 * wrong and cannot be pointed at another company's reports.
 */
export default async function ClientReportingPage() {
  const { services } = await getClientContext();

  let reports: ClientReportView[] = [];
  let denied = false;
  let loadError: string | null = null;

  try {
    await services.permissions.requireModuleAccess("portal_reporting");
    reports = toClientReportViews(await services.reporting.listMine());
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Reporting could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Reporting</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  return <ClientReportingView reports={reports} />;
}
