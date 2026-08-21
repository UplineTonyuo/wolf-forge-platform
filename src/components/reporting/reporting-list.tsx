import Link from "next/link";
import type { InternalReportView } from "../../domain/reporting/projections";
import { EmptyState } from "../ui/list-states";
import styles from "./reporting.module.css";

/**
 * The reporting workspace list.
 *
 * Drafts and sent reports live in one list rather than two screens, because the
 * question William actually asks is "where is Northgate's August report" and
 * the answer should not depend on remembering whether he finished it. The
 * status mark and the timestamp carry the difference.
 *
 * Server-rendered and stateless: filtering is a link to the same route, the
 * same idiom Coupons and Invoices use.
 */
export function ReportingList({
  reports,
  emptyBody,
}: {
  reports: InternalReportView[];
  emptyBody: string;
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        title="No reports here yet"
        body={emptyBody}
        action={
          <Link className={styles.primaryButton} href="/reporting/new">
            New report
          </Link>
        }
      />
    );
  }

  return (
    <ol className={styles.list}>
      {reports.map((report) => (
        <li className={styles.row} key={report.id}>
          <div className={styles.rowMain}>
            <Link className={styles.rowLink} href={`/reporting/${report.id}`}>
              {report.title}
            </Link>

            <p className={styles.rowMeta}>
              <span>
                <strong>{report.companyName}</strong>
              </span>
              <span>{report.packageLabel}</span>
              <span>{report.laneLabel}</span>
              <span>
                {report.sectionCount} section{report.sectionCount === 1 ? "" : "s"} ·{" "}
                {report.entryCount} entr{report.entryCount === 1 ? "y" : "ies"}
              </span>
              <span>{report.timeLabel}</span>
            </p>
          </div>

          <div className={styles.rowSide}>
            <span className={styles.status} data-status={report.status}>
              {report.statusLabel}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
