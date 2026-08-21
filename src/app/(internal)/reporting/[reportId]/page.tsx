import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportBuilder } from "../../../../components/reporting/report-builder";
import { ReportWizard } from "../../../../components/reporting/report-wizard";
import { DataError } from "../../../../components/ui/list-states";
import { PageFrame } from "../../../../components/ui/page-frame";
import type { InternalReportDocument } from "../../../../domain/reporting/schema";
import { reportingProfileForService } from "../../../../domain/reporting/service-profiles";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Report" };

/**
 * One report, in the builder.
 *
 * The document is read from the database on every request, which is what makes
 * a draft a draft: navigating away, refreshing, or coming back tomorrow resumes
 * exactly what was saved rather than whatever React happened to be holding.
 *
 * A sent report opens read-only. The RPCs refuse to edit it regardless, so this
 * is the honest presentation of a rule that already exists rather than the rule
 * itself.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const [{ reportId }, query, { user, services }] = await Promise.all([
    params,
    searchParams,
    getInternalContext(),
  ]);

  let report: InternalReportDocument | null = null;
  let denied = false;
  let missing = false;
  let loadError: string | null = null;

  try {
    await services.permissions.requireModuleAccess("reporting");
    report = await services.reporting.getInternal(reportId);
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else if (safe.code === "NOT_FOUND" || safe.code === "VALIDATION_ERROR") missing = true;
    else loadError = safe.message || "This report could not be loaded.";
  }

  // Both throw their own control-flow error, so they stay outside the catch.
  if (denied) redirect("/reporting");
  if (missing) notFound();

  return (
    <PageFrame
      title={report?.title ?? "Report"}
      description={
        <>
          <Link href="/reporting">Reporting</Link>
          {report ? ` · ${report.company_name}` : null}
        </>
      }
    >
      {report === null ? (
        <DataError message={loadError ?? "This report could not be loaded."} />
      ) : report.status === "draft"
        && query.mode !== "advanced"
        && reportingProfileForService(report.service_id) ? (
        <ReportWizard document={report} canSend={user.reporting.send} />
      ) : (
        <ReportBuilder document={report} canSend={user.reporting.send} />
      )}
    </PageFrame>
  );
}
