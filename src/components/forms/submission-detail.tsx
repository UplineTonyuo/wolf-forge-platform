"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctFormSubmissionAction } from "../../app/actions/forms";
import type { FormSubmissionDetail } from "../../domain/forms/schema";
import type { Json } from "../../lib/supabase/database.types";
import { formatDate } from "../../lib/format";
import { titleCaseState } from "../../lib/forms/presentation";
import styles from "./forms.module.css";
import { SubmittedFile } from "./submitted-file";
import { loadIntakeFollowUp } from "../../app/actions/intake-drafts";
import { SignatureDrawing } from "./drawn-signature";
import { readSignatureStrokes } from "../../lib/forms/signature";
import { DownloadFormPdf } from "./download-form-pdf";

function displayValue(value: Json) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.name === "string" && value.consent === true) {
    return `${value.name}\nElectronic signature · consent recorded${typeof value.signed_at === "string" ? `\nSigned ${formatDate(value.signed_at)}` : ""}`;
  }
  return JSON.stringify(value, null, 2);
}

function SubmittedSignature({ value }: { value: Json }) {
  const drawing = value && typeof value === "object" && !Array.isArray(value) ? readSignatureStrokes(value.drawing) : null;
  return <div>{drawing ? <SignatureDrawing strokes={drawing} label="Submitted client signature" /> : null}<pre>{displayValue(value)}</pre></div>;
}

export function SubmissionDetail({ detail, canCorrect, automaticPdf = false }: { detail: FormSubmissionDetail; canCorrect: boolean; automaticPdf?: boolean }) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState(false);
  const [values, setValues] = useState<Record<string, Json>>(() => Object.fromEntries(detail.values.map((value) => [value.stable_field_key, value.value])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestId = useMemo(() => crypto.randomUUID(), []);
  const [followUp, setFollowUp] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void loadIntakeFollowUp(detail.submission.id).then((status) => { if (!disposed) setFollowUp(status); });
    return () => { disposed = true; };
  }, [detail.submission.id]);

  function correct() {
    startTransition(async () => {
      const result = await correctFormSubmissionAction(detail.submission.id, { request_id: requestId, values: detail.values.map((item) => ({ field_key: item.stable_field_key, value: values[item.stable_field_key] as never })) });
      if (!result.ok) setError(result.error);
      else router.push(`/forms/submissions/${result.data.id}?corrected=1`);
    });
  }

  return <div className={styles.submissionDetail}>
    <DownloadFormPdf submissionId={detail.submission.id} automatic={automaticPdf} />
    {followUp && followUp !== "not_required" ? <p className={followUp === "blocked" ? styles.actionError : undefined} role="status">
      {followUp === "completed" ? "Automatic follow-up completed." : followUp === "blocked"
        ? "Automatic follow-up needs staff review. Check the form publisher’s current permissions and configured Service." : "Automatic follow-up is awaiting processing."}
    </p> : null}
    <section className={styles.submissionMeta}><dl><div><dt>Submitted</dt><dd>{formatDate(detail.submission.submitted_at)}</dd></div><div><dt>Revision</dt><dd>{detail.submission.revision_number === 1 ? "Original submission" : `Correction · Revision ${detail.submission.revision_number}`}</dd></div><div><dt>Status</dt><dd>{titleCaseState(detail.submission.status)}</dd></div><div><dt>Version identity</dt><dd>Exact historical Form version retained</dd></div></dl></section>
    <section className={styles.answerSheet}><header><div><span>{correcting ? "New append-only revision" : "Historical answers"}</span><h2>{correcting ? "Create a correction" : "Submitted responses"}</h2></div>{canCorrect && !correcting ? <button className="button-secondary" type="button" onClick={() => setCorrecting(true)}><RotateCcw aria-hidden="true" />Correct submission</button> : null}</header><div>{detail.values.map((item) => <label key={item.stable_field_key}><span>{item.label}</span>{correcting && !["file", "signature"].includes(item.field_type) ? ["checkbox", "optin"].includes(item.field_type) ? <input type="checkbox" checked={values[item.stable_field_key] === true} onChange={(event) => setValues((current) => ({ ...current, [item.stable_field_key]: event.target.checked }))} /> : <textarea value={displayValue(values[item.stable_field_key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [item.stable_field_key]: event.target.value }))} /> : item.field_type === "file" && Array.isArray(item.value) ? <div>{item.value.filter((id): id is string => typeof id === "string").map((id) => <SubmittedFile key={id} id={id} />)}</div> : item.field_type === "signature" ? <SubmittedSignature value={item.value} /> : <pre>{displayValue(item.value)}</pre>}<small>{titleCaseState(item.field_type)}</small></label>)}</div>{error ? <p className={styles.actionError} role="alert">{error}</p> : null}{correcting ? <footer><button className="button-secondary" type="button" onClick={() => setCorrecting(false)}>Cancel</button><button className="button-primary" type="button" aria-busy={pending || undefined} disabled={pending} onClick={correct}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Save correction</button></footer> : null}</section>
  </div>;
}
