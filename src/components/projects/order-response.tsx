"use client";

import { Fragment, useId, useRef, useState } from "react";
import type { FormSubmissionDetail } from "../../domain/forms/schema";
import { formatDateTime } from "../../lib/format";
import { DownloadFormPdf } from "../forms/download-form-pdf";
import { SubmittedAnswer } from "../forms/submitted-answer";
import { IntakeSecretReferences } from "../forms/intake-secret-reveal";
import { visibleSubmittedFields } from "../../lib/forms/submitted-fields";
import styles from "./order-responses.module.css";

export function OrderResponse({ detail, latest = true }: { detail: FormSubmissionDetail; latest?: boolean }) {
  const fields = visibleSubmittedFields(detail.values);
  const long = fields.length > 6 || fields.some((field) => (typeof field.value === "string" && field.value.length > 400) || (Array.isArray(field.value) && field.value.length > 6));
  const [expanded, setExpanded] = useState(!long && latest);
  const contentId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  function toggle() {
    if (expanded && content.current?.contains(document.activeElement)) button.current?.focus();
    setExpanded(!expanded);
  }

  return <section className={styles.response} aria-label={`${latest ? "Latest response" : "Earlier revision"} ${detail.submission.revision_number}`}>
    <header className={styles.header}>
      <div>
        <h3>{latest ? "Latest response" : "Earlier revision"} · Revision {detail.submission.revision_number}</h3>
        <p><time dateTime={detail.submission.submitted_at}>{formatDateTime(detail.submission.submitted_at)}</time> · {fields.length} fields</p>
      </div>
      <DownloadFormPdf submissionId={detail.submission.id} automatic={false} signedOriginal={detail.has_signed_agreement} />
    </header>
    <button ref={button} type="button" className="button-secondary" aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
      {expanded ? "Hide responses" : "Show responses"}
    </button>
    <div id={contentId} ref={content} className={styles.disclosure} data-open={expanded} inert={!expanded} aria-hidden={!expanded}>
      <div className={styles.disclosureInner}>
        {fields.length ? <dl className={styles.fields}>
          {fields.map((field) => <Fragment key={field.stable_field_key}><dt>{field.label}</dt><dd><SubmittedAnswer field={field} /></dd></Fragment>)}
        </dl> : <p>No visible responses were recorded.</p>}
        {expanded && detail.has_saved_credentials === true ? <IntakeSecretReferences key={detail.submission.id} submissionId={detail.submission.id} /> : null}
      </div>
    </div>
  </section>;
}
