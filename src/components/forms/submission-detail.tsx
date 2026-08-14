"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctFormSubmissionAction } from "../../app/actions/forms";
import type { FormSubmissionDetail } from "../../domain/forms/schema";
import type { Json } from "../../lib/supabase/database.types";
import { formatDate } from "../../lib/format";
import { titleCaseState } from "../../lib/forms/presentation";
import styles from "./forms.module.css";

function displayValue(value: Json) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

export function SubmissionDetail({ detail, canCorrect }: { detail: FormSubmissionDetail; canCorrect: boolean }) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState(false);
  const [values, setValues] = useState<Record<string, Json>>(() => Object.fromEntries(detail.values.map((value) => [value.stable_field_key, value.value])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestId = useMemo(() => crypto.randomUUID(), []);

  function correct() {
    startTransition(async () => {
      const result = await correctFormSubmissionAction(detail.submission.id, { request_id: requestId, values: detail.values.map((item) => ({ field_key: item.stable_field_key, value: values[item.stable_field_key] as never })) });
      if (!result.ok) setError(result.error);
      else router.push(`/forms/submissions/${result.data.id}?corrected=1`);
    });
  }

  return <div className={styles.submissionDetail}>
    <section className={styles.submissionMeta}><dl><div><dt>Submitted</dt><dd>{formatDate(detail.submission.submitted_at)}</dd></div><div><dt>Revision</dt><dd>{detail.submission.revision_number === 1 ? "Original submission" : `Correction · Revision ${detail.submission.revision_number}`}</dd></div><div><dt>Status</dt><dd>{titleCaseState(detail.submission.status)}</dd></div><div><dt>Version identity</dt><dd>Exact historical Form version retained</dd></div></dl></section>
    <section className={styles.answerSheet}><header><div><span>{correcting ? "New append-only revision" : "Historical answers"}</span><h2>{correcting ? "Create a correction" : "Submitted responses"}</h2></div>{canCorrect && !correcting ? <button className="button-secondary" type="button" onClick={() => setCorrecting(true)}><RotateCcw aria-hidden="true" />Correct submission</button> : null}</header><div>{detail.values.map((item) => <label key={item.stable_field_key}><span>{item.label}</span>{correcting ? ["checkbox", "optin"].includes(item.field_type) ? <input type="checkbox" checked={values[item.stable_field_key] === true} onChange={(event) => setValues((current) => ({ ...current, [item.stable_field_key]: event.target.checked }))} /> : <textarea value={displayValue(values[item.stable_field_key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [item.stable_field_key]: event.target.value }))} /> : <pre>{displayValue(item.value)}</pre>}<small>{titleCaseState(item.field_type)}</small></label>)}</div>{error ? <p className={styles.actionError} role="alert">{error}</p> : null}{correcting ? <footer><button className="button-secondary" type="button" onClick={() => setCorrecting(false)}>Cancel</button><button className="button-primary" type="button" disabled={pending} onClick={correct}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Save correction</button></footer> : null}</section>
  </div>;
}
