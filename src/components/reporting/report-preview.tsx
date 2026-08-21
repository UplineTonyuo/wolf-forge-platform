import { ExternalLink } from "lucide-react";
import { isSafeReportUrl } from "../../domain/reporting/projections";
import {
  reportLaneLabels,
  type ReportDraftSectionInput,
  type ReportLane,
} from "../../domain/reporting/schema";
import styles from "./reporting.module.css";

/**
 * The structured report, as the client will read it.
 *
 * Built from exactly the data the send RPC will store — report, ordered
 * sections, ordered entries — so a preview cannot flatter a report into looking
 * more complete than what actually gets delivered. The final client-facing
 * detail experience is Phase 3; this is the operator's honest rehearsal of it.
 *
 * A URL is a named link, never printed raw, and it is re-checked here rather
 * than trusted. The value already passed the editor, the domain schema and the
 * database CHECK, but a render path that trusts a string it never looked at is
 * the one place an unsafe scheme would actually become clickable.
 */
export function ReportPreview({
  companyName,
  title,
  lane,
  packageLabel,
  sections,
  sentLabel,
}: {
  companyName: string;
  title: string;
  lane: ReportLane;
  packageLabel: string;
  sections: readonly ReportDraftSectionInput[];
  /** "Sent 18 Aug 2026" when it has been; omitted while it is still a draft. */
  sentLabel?: string | null;
}) {
  const populated = sections.filter((section) => section.title.trim() !== "");

  return (
    <article className={styles.preview}>
      <header className={styles.previewHead}>
        <span className={styles.previewEyebrow}>{reportLaneLabels[lane]}</span>
        <h2>{title.trim() === "" ? "Untitled report" : title}</h2>
        <p className={styles.previewMeta}>
          <span>
            Prepared for <strong>{companyName}</strong>
          </span>
          <span>
            Package <strong>{packageLabel}</strong>
          </span>
          {sentLabel ? <span>{sentLabel}</span> : null}
        </p>
      </header>

      {populated.length === 0 ? (
        <p className={styles.previewEmpty}>
          This report has no sections yet, so there is nothing for the client to read.
        </p>
      ) : (
        <ol className={styles.previewSections}>
          {populated.map((section, sectionIndex) => {
            const entries = section.entries.filter((entry) => entry.label.trim() !== "");

            return (
              <li
                className={styles.previewSection}
                key={`${section.section_key}-${sectionIndex}`}
              >
                <h3>{section.title}</h3>

                {entries.length === 0 ? (
                  <p className={styles.previewEmpty}>Nothing reported in this section.</p>
                ) : (
                  <dl className={styles.previewEntries}>
                    {entries.map((entry, entryIndex) => (
                      <div className={styles.previewEntry} key={`${entry.label}-${entryIndex}`}>
                        <dt className={styles.previewLabel}>{entry.label}</dt>
                        <dd className={styles.previewValue}>
                          {entry.value ? (
                            <span className={styles.previewValueText}>{entry.value}</span>
                          ) : null}

                          {isSafeReportUrl(entry.url) ? (
                            <span className={styles.previewValueLink}>
                              <a
                                href={entry.url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                <ExternalLink aria-hidden="true" />
                                View
                              </a>
                            </span>
                          ) : null}

                          {!entry.value && !isSafeReportUrl(entry.url) ? (
                            <span className={styles.previewEmpty}>No detail</span>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
