import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ClientReportDocument } from "../../../domain/reporting/schema";
import { reportLaneLabels } from "../../../domain/reporting/schema";
import { isSafeReportUrl } from "../../../domain/reporting/projections";
import { singleEntryRepeatsSectionTitle } from "../../../domain/reporting/present";
import { formatDate } from "../../../lib/format";
import { ClientReportReadReceipt } from "./client-report-read-receipt";
import styles from "./client-report-viewer.module.css";

function sectionAnchor(sectionKey: string, index: number) {
  return `report-section-${sectionKey}-${index + 1}`;
}

export function ClientReportViewer({ report }: { report: ClientReportDocument }) {
  const hasContents = report.sections.length > 1;

  return (
    <article className={`portal-page ${styles.page}`}>
      {!report.is_read ? <ClientReportReadReceipt reportId={report.report_id} /> : null}

      <Link href="/account/reporting" className="portal-back">
        <ArrowLeft aria-hidden="true" />
        All reports
      </Link>

      <header className={styles.header}>
        <div className={styles.identity}>
          <h1>{report.title}</h1>
          <p>Prepared for {report.company_name}</p>
        </div>

        <dl className={styles.facts}>
          <div>
            <dt>Reporting lane</dt>
            <dd>{reportLaneLabels[report.report_lane]}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{report.package_label}</dd>
          </div>
          <div>
            <dt>Sent</dt>
            <dd>
              <time dateTime={report.sent_at}>{formatDate(report.sent_at)}</time>
            </dd>
          </div>
        </dl>
      </header>

      {report.sections.length === 0 ? (
        <p className={styles.emptyReport}>No report sections were included.</p>
      ) : (
        <div className={styles.reportLayout} data-with-contents={hasContents || undefined}>
          {hasContents ? (
            <aside className={styles.contents}>
              <h2>In this report</h2>
              <nav aria-label="Report sections">
                <ul>
                  {report.sections.map((section, index) => (
                    <li key={`${section.section_key}-${index}`}>
                      <a href={`#${sectionAnchor(section.section_key, index)}`}>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          ) : null}

          <div className={styles.document}>
            {report.sections.map((section, sectionIndex) => {
              const headingId = sectionAnchor(section.section_key, sectionIndex);
              const repeatLabel = singleEntryRepeatsSectionTitle(section);

              return (
                <section
                  className={styles.section}
                  key={`${section.section_key}-${sectionIndex}`}
                  aria-labelledby={headingId}
                  data-sparse={section.entries.length === 1 || undefined}
                >
                  <h2 id={headingId}>{section.title}</h2>

                  {section.entries.length === 0 ? (
                    <p className={styles.emptySection}>No updates were included in this section.</p>
                  ) : (
                    <dl className={styles.entries}>
                      {section.entries.map((entry, entryIndex) => {
                        const safeUrl = isSafeReportUrl(entry.url) ? entry.url : null;

                        return (
                          <div
                            className={
                              repeatLabel
                                ? `${styles.entry} ${styles.entrySingle}`
                                : styles.entry
                            }
                            key={`${entry.label}-${entryIndex}`}
                          >
                            <dt className={repeatLabel ? styles.entryLabelHidden : undefined}>
                              {entry.label}
                            </dt>
                            <dd>
                              {entry.value ? <p>{entry.value}</p> : null}
                              {safeUrl ? (
                                <a
                                  className={styles.asset}
                                  href={safeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`View asset for ${entry.label}. Opens in a new tab.`}
                                >
                                  View asset
                                  <ExternalLink aria-hidden="true" />
                                </a>
                              ) : null}
                              {!entry.value && !safeUrl ? (
                                <span className={styles.noDetail}>No detail included</span>
                              ) : null}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
