import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { ReportingList } from "../../../components/reporting/reporting-list";
import styles from "../../../components/reporting/reporting.module.css";
import { DataError } from "../../../components/ui/list-states";
import { ListToolbar } from "../../../components/ui/list-toolbar";
import { PageFrame } from "../../../components/ui/page-frame";
import {
  countInternalReports,
  toInternalReportViews,
  type InternalReportView,
} from "../../../domain/reporting/projections";
import { reportStatusSchema } from "../../../domain/reporting/schema";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Reporting" };

/**
 * The internal Reporting workspace.
 *
 * Every report Wolf Forge has built for a client, drafts and delivered alike.
 * The list is loaded whole and filtered by status server-side through a link,
 * so a filter is a URL rather than a piece of state.
 *
 * The module boundary is the authority, not the rail. Typing this URL reaches
 * app_list_internal_reports and is refused exactly the way a hidden nav item is.
 */
export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ status }, { user, services }] = await Promise.all([
    searchParams,
    getInternalContext(),
  ]);

  /* An unrecognised filter is not an error, it is simply no filter. */
  const filter = reportStatusSchema.safeParse(status);
  const activeFilter = filter.success ? filter.data : null;

  let reports: InternalReportView[] = [];
  let denied = false;
  let loadError: string | null = null;

  try {
    await services.permissions.requireModuleAccess("reporting");
    reports = toInternalReportViews(await services.reporting.listInternal());
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Reporting could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/");

  const counts = countInternalReports(reports);
  const visible =
    activeFilter === null
      ? reports
      : reports.filter((report) => report.status === activeFilter);

  const newReport = user.reporting.send ? (
    <Link className={`${styles.primaryButton} ${styles.toolbarAction}`} href="/reporting/new">
      <Plus aria-hidden="true" />New report
    </Link>
  ) : null;

  const newReportCompact = user.reporting.send ? (
    <Link
      className={`${styles.compactAction} page-action-compact`}
      href="/reporting/new"
      aria-label="New report"
      title="New report"
    >
      <Plus aria-hidden="true" />
    </Link>
  ) : null;

  return (
    <PageFrame
      title="Reporting"
      description="Build, save and deliver structured client reports."
      action={newReportCompact}
    >
      {loadError ? (
        <DataError message={loadError} />
      ) : (
        <>
          <ListToolbar
            label="Report status filters"
            action={newReport}
            filters={[
              {
                value: "all",
                label: `All (${counts.total})`,
                href: "/reporting",
                active: activeFilter === null,
              },
              {
                value: "draft",
                label: `Drafts (${counts.draft})`,
                href: "/reporting?status=draft",
                active: activeFilter === "draft",
              },
              {
                value: "sent",
                label: `Sent (${counts.sent})`,
                href: "/reporting?status=sent",
                active: activeFilter === "sent",
              },
            ]}
          />

          <ReportingList
            reports={visible}
            emptyBody={
              activeFilter === "draft"
                ? "Nothing is part-written. Start a report and it will wait here until you send it."
                : activeFilter === "sent"
                  ? "No report has been delivered yet."
                  : "Start a report for a client and it will be saved as a draft until you send it."
            }
          />
        </>
      )}
    </PageFrame>
  );
}
