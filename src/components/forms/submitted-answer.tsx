"use client";

import type { Json } from "../../lib/supabase/database.types";
import { formatDate } from "../../lib/format";
import { readSignatureStrokes } from "../../lib/forms/signature";
import { SignatureDrawing } from "./drawn-signature";
import { SubmittedFile } from "./submitted-file";
import styles from "./submitted-answer.module.css";
import { visibleSubmittedFields, type SubmittedField } from "../../lib/forms/submitted-fields";

function PlainValue({ value }: { value: Json }) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return <span>Not answered</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return /^https?:\/\/\S+$/iu.test(text)
      ? <a href={text} target="_blank" rel="noopener noreferrer">{text}</a>
      : <>{text}</>;
  }
  if (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
    return <ul className={styles.list}>{value.map((item, index) => <li key={index}><PlainValue value={item} /></li>)}</ul>;
  }
  return <span>Response unavailable</span>;
}

export function SubmittedAnswer({ field }: { field: SubmittedField }) {
  if (!visibleSubmittedFields([field]).length) return null;
  if (field.field_type === "file") {
    const ids = Array.isArray(field.value) ? field.value.filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) : [];
    return <div className={styles.answer}>{ids.length ? ids.map((id) => <div key={id}><SubmittedFile key={id} id={id} /></div>) : "Not answered"}</div>;
  }
  if (field.field_type === "signature") {
    const value = field.value;
    if (typeof value === "string") return <div className={styles.answer}>{value || "Not answered"}</div>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return <span>Not answered</span>;
    const drawing = readSignatureStrokes(value.drawing);
    const signedAt = typeof value.signed_at === "string" && Number.isFinite(Date.parse(value.signed_at)) ? value.signed_at : null;
    return <div className={styles.answer}>
      {drawing ? <SignatureDrawing strokes={drawing} label="Submitted client signature" /> : null}
      <p>{typeof value.name === "string" && value.name ? value.name : "Signer not recorded"}</p>
      <p>{value.consent === true ? "Electronic signature · consent recorded" : "Consent not recorded"}</p>
      {signedAt ? <p>Signed <time dateTime={signedAt}>{formatDate(signedAt)}</time></p> : null}
      {value.drawing != null && !drawing ? <p>Signature drawing unavailable</p> : null}
    </div>;
  }
  return <div className={styles.answer}><PlainValue value={field.value} /></div>;
}
