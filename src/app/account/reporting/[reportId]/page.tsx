import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClientReportSlideshow } from "../../../../components/account/reporting/client-report-slideshow";
import { ClientReportViewer } from "../../../../components/account/reporting/client-report-viewer";
import type { ClientReportDocument } from "../../../../domain/reporting/schema";
import { buildReportSlides } from "../../../../domain/reporting/slideshow";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Report" };

export default async function ClientReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const [{ reportId }, context] = await Promise.all([params, getClientContext()]);

  let moduleDenied = false;
  try {
    await context.services.permissions.requireModuleAccess("portal_reporting");
  } catch {
    moduleDenied = true;
  }

  // Navigation APIs throw control-flow errors, so they stay outside catches.
  if (moduleDenied) redirect("/account");

  let report: ClientReportDocument | null = null;
  try {
    report = await context.services.reporting.getMine(reportId);
  } catch (error) {
    const safe = toClientSafeError(error);
    if (["VALIDATION_ERROR", "NOT_FOUND", "PERMISSION_DENIED"].includes(safe.code)) {
      notFound();
    }
    throw error;
  }

  if (!report) notFound();

  return (
    <ClientReportSlideshow slides={buildReportSlides(report)}>
      <ClientReportViewer report={report} />
    </ClientReportSlideshow>
  );
}
