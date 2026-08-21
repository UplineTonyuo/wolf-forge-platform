import { ArrowRight, BarChart3, MapPin } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import type { ClientReportView } from "../../../domain/reporting/projections";
import type { ReportLane } from "../../../domain/reporting/schema";
import styles from "./client-reporting.module.css";

/**
 * The client's report vault.
 *
 * Every card opens Wolf Forge's native report detail. External assets live
 * inside that document and are opened individually, never as the report itself.
 */

const reportIcons: Record<ReportLane, ComponentType<{ "aria-hidden": true }>> = {
  seo_package: BarChart3,
  gmb_management: MapPin,
};

function ReportRow({ report, index }: { report: ClientReportView; index: number }) {
  const Icon = reportIcons[report.lane] ?? BarChart3;

  return (
    <li className={styles.item} style={{ "--wf-report-index": index } as React.CSSProperties}>
      <Link
        className={styles.report}
        href={`/account/reporting/${report.id}`}
        data-unread={!report.isRead || undefined}
        aria-label={`${report.packageLabel}: ${report.title}, ${report.laneLabel}, sent ${report.sentLabel}. Read report.`}
      >
        <span className={styles.mark} data-type={report.lane}>
          <Icon aria-hidden={true} />
        </span>

        <span className={styles.main}>
          <span className={styles.top}>
            <span className={styles.type} data-type={report.lane}>
              {report.packageLabel}
            </span>
            <span className={!report.isRead ? styles.new : styles.readState}>
              {!report.isRead ? "New" : "Read"}
            </span>
          </span>

          <span className={styles.title}>{report.title}</span>
          <span className={styles.meta}>
            <span>{report.laneLabel}</span>
            <span aria-hidden="true">·</span>
            <span>Sent {report.sentLabel}</span>
          </span>
        </span>

        <span className={styles.cta}>
          Read report
          <ArrowRight aria-hidden={true} />
        </span>
      </Link>
    </li>
  );
}

export function ClientReportingView({ reports }: { reports: ClientReportView[] }) {
  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Reporting</h1>
        <p>Performance reports from your Wolf Forge team.</p>
      </header>

      {reports.length === 0 ? (
        <p className="portal-empty">
          No reports yet. Your Wolf Forge team will share performance reports here when
          they&rsquo;re ready.
        </p>
      ) : (
        <ul className={styles.vault}>
          {reports.map((report, index) => (
            <ReportRow key={report.id} report={report} index={index} />
          ))}
        </ul>
      )}
    </div>
  );
}
