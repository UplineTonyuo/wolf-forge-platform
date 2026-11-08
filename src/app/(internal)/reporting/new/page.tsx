import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewReportForm } from "../../../../components/reporting/new-report-form";
import { DataError } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";
import { listReportServiceChoicesAction } from "../../../actions/reporting";
import { reportSetupScopeSchema } from "../../../../domain/reporting/order-completion";

export const metadata: Metadata = { title: "New report" };

/**
 * Starting a report.
 *
 * The client list comes from the existing company source of truth through the
 * company service, so there is no second client directory to drift. Company RLS
 * decides what comes back; this page invents nothing.
 *
 * Sending capability is checked here as well as in every RPC, because a staff
 * account without reports.send should be told at the door rather than after
 * filling in a whole report.
 */
export default async function NewReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, services } = await getInternalContext();

  let clients: { id: string; name: string }[] = [];
  let denied = false;
  let loadError: string | null = null;

  try {
    await services.permissions.requireModuleAccess("reporting");
    const companies = await services.companies.listActive();
    clients = companies.map((company) => ({ id: company.id, name: company.name }));
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Clients could not be loaded.";
  }

  if (denied || !user.reporting.send) redirect("/reporting");

  const query = await searchParams;
  const hasPrefill = query.companyId !== undefined || query.serviceId !== undefined || query.reportingPeriodMonth !== undefined;
  const scope = hasPrefill ? reportSetupScopeSchema.safeParse(query) : null;
  const prefill = scope?.success ? scope.data : undefined;
  const options = prefill ? await listReportServiceChoicesAction({ companyId: prefill.companyId }) : null;
  if (hasPrefill && (!prefill || !clients.some((client) => client.id === prefill.companyId)
    || !options?.ok || !options.choices.some((choice) => choice.serviceId === prefill.serviceId))) {
    loadError = "This client, Service or reporting month is unavailable. Return to Reporting and choose an eligible Service.";
  }

  return (
    <PageFrame
      title="New report"
      description="Choose the client, then the Service. The recurring report opens as a guided saved draft."
      narrow
    >
      {loadError ? <DataError message={loadError} /> : <NewReportForm clients={clients} prefill={prefill} initialChoices={options?.ok ? options.choices : []} />}
    </PageFrame>
  );
}
