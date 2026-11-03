"use client";

import { CheckCircle2, FileLock2, LoaderCircle, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadFormCollectionAvailability, submitAssignedFormAction, submitPublicFormAction } from "../../app/actions/forms";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import type { FormPublishedSchema, SubmitFormInput } from "../../domain/forms/schema";
import { intakeSecretReferenceSchema } from "../../domain/forms/schema";
import type { Json } from "../../lib/supabase/database.types";
import { sanitizeFormHtml } from "../../lib/forms/presentation";
import styles from "./forms.module.css";
import { loadIntakeDraft, saveIntakeDraft } from "../../app/actions/intake-drafts";
import { ACCESS_REFRESH_INTERVAL_MS } from "../../domain/polling-constants";
import { IntakeFileField } from "./intake-file-field";
import { DrawnSignature } from "./drawn-signature";
import { readSignatureStrokes } from "../../lib/forms/signature";
import Link from "next/link";
import { DownloadFormPdf } from "./download-form-pdf";
import { AgreementDisclosure } from "./agreement-disclosure";
import { IntakeSecretField } from "./intake-secret-field";
import { captureIntakeSecret } from "../../app/actions/intake-secrets";

type AnswerMap = Record<string, Json | undefined>;

const structuralTypes = new Set(["payment", "hidden", "break", "pagebreak", "html", "secret", "password", "captcha"]);
const displayOnly = (field: FormPublishedSchema["fields"][number]) => field.field_type === "richtext" && field.settings.display_only === true;
const agreementContent = (field: FormPublishedSchema["fields"][number]) => field.field_type === "signature" || /\bagreement\b|\bpolicy\b|\bterms\b/iu.test(field.label);

export function isFormFieldVisible(
  fieldKey: string,
  rules: FormPublishedSchema["rules"],
  answers: AnswerMap,
) {
  const targeting = rules.filter((rule) => rule.target_field_keys.includes(fieldKey));
  const match = (rule: FormPublishedSchema["rules"][number]) => rule.conditions.every((condition) => {
    const actual = answers[condition.field_key];
    if (condition.comparator === "checked") return actual === true;
    if (condition.comparator === "not_checked") return actual !== true;
    if (condition.comparator === "equals") return JSON.stringify(actual) === JSON.stringify(condition.value);
    return JSON.stringify(actual) !== JSON.stringify(condition.value);
  });
  const showRules = targeting.filter((rule) => rule.action === "show");
  return (showRules.length === 0 || showRules.some(match))
    && !targeting.some((rule) => rule.action === "hide" && match(rule));
}

function FieldControl({
  field,
  id,
  value,
  onChange,
  disabled,
}: {
  field: FormPublishedSchema["fields"][number];
  id: string;
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
}) {
  const stringValue = typeof value === "string" ? value : "";
  const common = {
    id,
    name: field.stable_field_key,
    required: field.required,
    disabled,
    placeholder: field.placeholder ?? undefined,
    "aria-describedby": field.help_html ? `${id}-help` : undefined,
  };
  if (field.field_type === "signature") {
    if (field.settings.signature_mode === "drawn") return <DrawnSignature id={id} label={field.label} value={value} required={field.required} disabled={disabled} onChange={onChange} />;
    const signature = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const name = typeof signature.name === "string" ? signature.name : "";
    return <div className={styles.signatureControl}>
      <input {...common} value={name} maxLength={200} autoComplete="name" placeholder="Type your full name"
        onChange={(event) => onChange({ name: event.target.value, consent: false })} />
      <label className={styles.checkControl}><input type="checkbox" checked={signature.consent === true}
        required={field.required || Boolean(name.trim())} disabled={disabled || !name.trim()}
        onChange={(event) => onChange({ name, consent: event.target.checked })} />
        <span>I agree to use my typed name as my electronic signature for this form.</span></label>
    </div>;
  }
  if (field.field_type === "textarea" || field.field_type === "richtext" || field.field_type === "data-spreadsheet") {
    return <textarea {...common} rows={field.field_type === "data-spreadsheet" ? 7 : 4} value={stringValue} onChange={(event) => onChange(event.currentTarget.value)} />;
  }
  if (["checkbox", "optin"].includes(field.field_type)) {
    return <label className={styles.checkControl}><input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} /><span>{field.placeholder || "Yes"}</span></label>;
  }
  if (["data-dropdown", "dropdown"].includes(field.field_type)) {
    const choices = field.field_type === "dropdown"
      ? field.services.map((service) => ({ id: service.service_id, label: service.name }))
      : field.options.map((option) => ({ id: option.option_id, label: option.label }));
    return <AnimatedSelect name={field.stable_field_key} label={field.label} menuLabel={field.label} value={stringValue} onChange={onChange} disabled={disabled} required={field.required} options={[{ value: "", label: "Select an option" }, ...choices.map((choice) => ({ value: choice.id, label: choice.label }))]} />;
  }
  if (field.field_type === "date") return <fieldset disabled={disabled}><DatePicker name={field.stable_field_key} label={field.label} menuLabel={field.label} value={stringValue} onChange={onChange} required={field.required} /></fieldset>;
  if (["data-option-group", "optgroup"].includes(field.field_type)) {
    const choices = field.field_type === "optgroup"
      ? field.services.map((service) => ({ id: service.service_id, label: service.name }))
      : field.options.map((option) => ({ id: option.option_id, label: option.label }));
    return <div className={styles.optionGroup}>{choices.map((choice) => <label key={choice.id}><input type="radio" name={field.stable_field_key} value={choice.id} checked={stringValue === choice.id} disabled={disabled} onChange={() => onChange(choice.id)} /><span>{choice.label}</span></label>)}</div>;
  }
  return <input {...common} type={field.field_type === "email" ? "email" : field.field_type === "phone" ? "tel" : "text"} value={stringValue} onChange={(event) => onChange(event.currentTarget.value)} />;
}

type FormRendererProps = {
  schema: FormPublishedSchema;
  mode?: "preview" | "assigned" | "public" | "readonly";
  assignmentId?: string;
  completed?: boolean;
  displayTitle?: string;
};

export function FormRenderer(props: FormRendererProps) {
  return <FormRendererContent key={`${props.schema.form_id}:${props.schema.form_version_id}:${props.schema.form_type}:${props.schema.visibility}:${props.assignmentId ?? ""}:${props.mode ?? "preview"}`} {...props} />;
}

function FormRendererContent({
  schema,
  mode = "preview",
  assignmentId,
  completed = false,
  displayTitle,
}: FormRendererProps) {
  const [answers, setAnswerState] = useState<AnswerMap>(() => Object.fromEntries(schema.fields.filter((field) => !["secret", "password"].includes(field.field_type)).map((field) => [field.stable_field_key, field.default_value ?? (field.field_type === "checkbox" ? false : "")])));
  const answerRef = useRef(answers);
  const draftFields = useRef(schema.fields);
  const revision = useRef(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const secretRef = useRef<Record<string, { value: string; requestId: string }>>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, { value: string; requestId: string }>>({});
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({});
  const encrypted = useCallback((field: FormPublishedSchema["fields"][number]) => field.field_type === "secret" && (field.settings.collection_mode === "encrypted" || field.encrypted_collection_allowed === true)
    && ["intake", "onboarding"].includes(schema.form_type) && schema.visibility === "assigned" && mode === "assigned" && Boolean(assignmentId), [schema.form_type, schema.visibility, mode, assignmentId]);
  const setAnswers = useCallback((next: AnswerMap | ((current: AnswerMap) => AnswerMap)) => {
    answerRef.current = typeof next === "function" ? next(answerRef.current) : next;
    setAnswerState(answerRef.current);
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; secretRef.current = {}; }; }, []);
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ id: string; followUp?: string; orderStart?: { id: string; status: string; started: boolean; requested: boolean } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [available, setAvailable] = useState(true);
  const supportsDraft = mode === "assigned" && Boolean(assignmentId) && !completed;
  const [draftLoading, setDraftLoading] = useState(supportsDraft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftLoadAttempt, setDraftLoadAttempt] = useState(0);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (!supportsDraft || !assignmentId) return;
    let disposed = false;
    const restoreRevision = revision.current;
    void loadIntakeDraft(assignmentId).then((response) => {
      if (disposed) return;
      if (restoreRevision !== revision.current) { setDraftLoading(false); return; }
      if (response.ok && response.draft) {
        setAnswers((defaults) => ({ ...defaults, ...Object.fromEntries(response.draft!.values.filter((answer) => {
          const field = draftFields.current.find((field) => field.stable_field_key === answer.field_key);
          return field && field.field_type !== "password" && (field.field_type !== "secret" || (encrypted(field) && intakeSecretReferenceSchema.safeParse(answer.value).success));
        }).map((answer) => [answer.field_key, answer.value])) }));
        setDraftMessage("Your saved draft has been restored.");
      } else if (!response.ok) setDraftError(response.error);
      setDraftLoading(false);
    });
    return () => { disposed = true; };
  }, [assignmentId, supportsDraft, draftLoadAttempt, encrypted, setAnswers]);
  useEffect(() => {
    if (mode !== "assigned" && mode !== "public") return;
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const enabled = await (mode === "assigned" && assignmentId
          ? loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id, assignmentId)
          : loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id));
        if (!disposed) {
          if (!enabled) { revision.current++; secretRef.current = {}; setSecretInputs({}); }
          setAvailable(enabled);
        }
      } finally { checking = false; }
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, ACCESS_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [mode, assignmentId, schema.canonical_key, schema.form_version_id]);
  const readonly = mode === "preview" || mode === "readonly" || completed || result != null || !available || draftLoading || Boolean(draftError) || uploading || draftState === "saving";
  const fields = useMemo(() => [...schema.fields].sort((a, b) => a.sort_order - b.sort_order), [schema.fields]);

  function draftValues(current: AnswerMap) {
    return fields.filter((field) => ((!structuralTypes.has(field.field_type) && !displayOnly(field))
      || (encrypted(field) && intakeSecretReferenceSchema.safeParse(current[field.stable_field_key]).success)))
      .map((field) => ({ field_key: field.stable_field_key, value: current[field.stable_field_key] ?? null }));
  }

  function changeSecret(key: string, value: string) {
    revision.current++;
    secretRef.current = { ...secretRef.current, [key]: { value, requestId: crypto.randomUUID() } };
    setSecretInputs(secretRef.current);
    setAnswers((current) => ({ ...current, [key]: undefined }));
    setSecretErrors((current) => ({ ...current, [key]: "" }));
    setDraftState("idle"); setDraftMessage("Unsaved changes. Save your progress before leaving.");
  }

  async function capturePasswords(visibleOnly: boolean): Promise<AnswerMap | null> {
    const startedRevision = revision.current;
    const captured: AnswerMap = { ...answerRef.current };
    for (const field of fields.filter((field) => encrypted(field) && (!visibleOnly || isFormFieldVisible(field.stable_field_key, schema.rules, captured)))) {
      const key = field.stable_field_key;
      const entry = secretRef.current[key];
      if (!entry?.value) continue;
      let response;
      try { response = await captureIntakeSecret({ request_id: entry.requestId, assignment_id: assignmentId!, field_key: key, secret: entry.value }); }
      catch { response = { ok: false as const, error: "The password could not be saved. Try again." }; }
      if (!alive.current) return null;
      if (startedRevision !== revision.current || secretRef.current[key] !== entry) {
        setError("Your responses changed while saving. Save or submit again.");
        return null;
      }
      const reference = response.ok ? intakeSecretReferenceSchema.safeParse(response.reference) : null;
      if (!response.ok || !reference?.success) {
        setSecretErrors((current) => ({ ...current, [key]: "The password could not be saved. Try again." }));
        return null;
      }
      captured[key] = reference.data;
      setAnswers((current) => ({ ...current, [key]: reference.data }));
      const remaining = { ...secretRef.current }; delete remaining[key];
      secretRef.current = remaining; setSecretInputs(remaining);
    }
    return startedRevision === revision.current ? captured : null;
  }

  async function saveDraft() {
    if (!assignmentId || readonly || pending || inFlight.current) return;
    inFlight.current = true;
    setDraftState("saving");
    setError(null);
    try {
      const captured = await capturePasswords(false);
      if (!captured) { if (alive.current) setDraftState("idle"); return; }
      const savedRevision = revision.current;
      const response = await saveIntakeDraft(assignmentId, draftValues(captured));
      if (!alive.current) return;
      if (savedRevision !== revision.current) { setDraftState("idle"); return; }
      if (!response.ok) { setDraftState("idle"); setError(response.error); }
      else { setDraftState("saved"); setDraftMessage("Draft saved. You can close this form and continue later. Saved drafts expire after 30 days."); }
    } catch {
      if (!alive.current) return;
      setDraftState("idle");
      setError("Your draft could not be saved. Check your connection and try again.");
    } finally { inFlight.current = false; }
  }

  function submit() {
    if (readonly || pending || inFlight.current) return;
    const missingPassword = fields.find((field) => encrypted(field) && field.required
      && isFormFieldVisible(field.stable_field_key, schema.rules, answerRef.current)
      && !secretRef.current[field.stable_field_key]?.value && !intakeSecretReferenceSchema.safeParse(answerRef.current[field.stable_field_key]).success);
    if (missingPassword) {
      setSecretErrors((current) => ({ ...current, [missingPassword.stable_field_key]: "Enter a password before submitting." }));
      document.getElementById(`form-field-${fields.indexOf(missingPassword)}`)?.focus();
      return;
    }
    const invalidSignature = fields.find((field) => {
      if (field.field_type !== "signature" || field.settings.signature_mode !== "drawn"
        || !isFormFieldVisible(field.stable_field_key, schema.rules, answers)) return false;
      const answer = answers[field.stable_field_key];
      if (!field.required && (!answer || (typeof answer === "object" && !Array.isArray(answer)
        && !answer.name && (!Array.isArray(answer.drawing) || !answer.drawing.length)))) return false;
      return !answer || typeof answer !== "object" || Array.isArray(answer)
        || answer.consent !== true || !readSignatureStrokes(answer.drawing);
    });
    if (invalidSignature) {
      setError(`Draw your signature and confirm consent for ${invalidSignature.label}.`);
      document.getElementById(`form-field-${fields.indexOf(invalidSignature)}`)?.focus();
      return;
    }
    const missingChoice = fields.find((field) => field.required
      && ["date", "dropdown", "data-dropdown", "data-option-group", "optgroup", "file"].includes(field.field_type)
      && isFormFieldVisible(field.stable_field_key, schema.rules, answers)
      && (!answers[field.stable_field_key] || (Array.isArray(answers[field.stable_field_key]) && !(answers[field.stable_field_key] as Json[]).length)));
    if (missingChoice) {
      setError(`Choose a value for ${missingChoice.label}.`);
      document.getElementsByName(missingChoice.stable_field_key).item(0)
        ?.parentElement?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    setError(null);
    inFlight.current = true;
    startTransition(async () => {
      try {
        const captured = await capturePasswords(true);
        if (!captured || !alive.current) return;
        const values: SubmitFormInput["values"] = fields
          .filter((field) => (!structuralTypes.has(field.field_type) || encrypted(field)) && !displayOnly(field) && isFormFieldVisible(field.stable_field_key, schema.rules, captured))
          .filter((field) => {
            const answer = captured[field.stable_field_key];
            return field.required || (answer !== undefined && answer !== null && answer !== ""
              && (!Array.isArray(answer) || answer.length > 0)
              && (field.field_type !== "signature" || (typeof answer === "object" && !Array.isArray(answer)
                && (field.settings.signature_mode === "drawn" ? Boolean(readSignatureStrokes(answer.drawing)) : typeof answer.name === "string" && Boolean(answer.name.trim())))));
          })
          .map((field) => ({ field_key: field.stable_field_key, value: (captured[field.stable_field_key] ?? null) as SubmitFormInput["values"][number]["value"] }));
        const input: SubmitFormInput = {
          request_id: requestId,
          form_version_id: schema.form_version_id,
          context: assignmentId ? { assignment_id: assignmentId } : {},
          values,
          files: [],
        };
        const submittedRevision = revision.current;
        const response = mode === "assigned"
          ? await submitAssignedFormAction(input, true)
          : await submitPublicFormAction(input);
        if (!alive.current || submittedRevision !== revision.current) return;
        if (!response.ok) {
          setError(response.error);
          setAvailable(await (mode === "assigned" && assignmentId
            ? loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id, assignmentId)
            : loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id)));
        }
        else setResult(response.data);
      } finally { inFlight.current = false; }
    });
  }

  if (result || completed) {
    return <section className={styles.formComplete} role="status" data-state="complete"><header className={styles.formCompleteHead}><CheckCircle2 aria-hidden="true" /><h2>{completed ? "Completed" : "Submitted"}</h2></header><p>Your responses have been saved.</p>
      {result && mode === "assigned" ? <DownloadFormPdf submissionId={result.id} automatic /> : null}
      {result?.orderStart ? <div><p>{result.orderStart.started ? (result.orderStart.status === "working" ? "Your order is now in progress." : "Your service forms and start request were completed.") : result.orderStart.requested ? "Your start request is saved. Complete any remaining required forms; your order will then start automatically." : "Your service form is complete. Open your order when you are ready to start."}</p><Link href={`/account/projects/${result.orderStart.id}`}>View your order →</Link></div> : null}
      {result?.followUp === "queued" || result?.followUp === "blocked" ? <p>Your form is saved. The team’s follow-up actions are awaiting processing.</p> : null}
    </section>;
  }

  if (!available) return <section className={styles.formComplete} role="status"><header className={styles.formCompleteHead}><FileLock2 aria-hidden="true" /><h2>Form collection is unavailable</h2></header><p>Outstanding requests and previously submitted responses are retained.</p></section>;

  return (
    <form className={styles.renderer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {mode === "preview" ? <div className={styles.previewFlag}>Draft Preview</div> : null}
      <header className={styles.rendererHeader}>
        <h1>{displayTitle ?? schema.title}</h1>
        <span>{schema.form_type} form{mode === "preview" ? ` · Version ${schema.version_number}` : ""}</span>
        {schema.information_html ? <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(schema.information_html) }} /> : null}
      </header>
      <div className={styles.rendererFields}>
        {fields.map((field, fieldIndex) => {
          const fieldDomId = `form-field-${fieldIndex}`;
          if (!isFormFieldVisible(field.stable_field_key, schema.rules, answers)) return null;
          if (displayOnly(field)) return <section className={styles.readableContent} key={field.stable_field_key}><h2>{field.label}</h2>
            {field.help_html ? agreementContent(field)
              ? <AgreementDisclosure id={`${fieldDomId}-agreement`}><div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /></AgreementDisclosure>
              : <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /> : null}</section>;
          if (field.field_type === "break") return <section className={styles.sectionBreak} key={field.stable_field_key}><h2>{field.label}</h2></section>;
          if (field.field_type === "pagebreak") return <div className={styles.pageBreak} key={field.stable_field_key}><span>{field.label}</span></div>;
          if (field.field_type === "html") return <div className={styles.safeHtml} key={field.stable_field_key} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(typeof field.settings.html === "string" ? field.settings.html : "") }} />;
          if (field.field_type === "hidden") return null;
          if (field.field_type === "secret" && encrypted(field)) return <div className={styles.renderField} key={field.stable_field_key}>
            <label htmlFor={fieldDomId}>{field.label}{field.required ? " *" : ""}</label>
            {field.help_html ? <div className={styles.fieldHelp} id={`${fieldDomId}-help`} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /> : null}
            <IntakeSecretField id={fieldDomId} label={field.label} value={secretInputs[field.stable_field_key]?.value ?? ""}
              saved={intakeSecretReferenceSchema.safeParse(answers[field.stable_field_key]).success}
              required={field.required} disabled={readonly || pending} describedBy={field.help_html ? `${fieldDomId}-help` : undefined}
              error={secretErrors[field.stable_field_key]} onChange={(value) => changeSecret(field.stable_field_key, value)} />
          </div>;
          if (["secret", "password"].includes(field.field_type)) return <div className={styles.integrationNotice} key={field.stable_field_key}><FileLock2 aria-hidden="true" /><div><strong>{field.label}</strong><span>Password collection is disabled for this field.</span></div></div>;
          if (field.field_type === "file") return <div className={styles.renderField} key={field.stable_field_key}>
            {Array.isArray(answers[field.stable_field_key]) && (answers[field.stable_field_key] as Json[]).length
              ? <span className={styles.fieldLabel}>{field.label}{field.required ? " *" : ""}</span>
              : <label htmlFor={fieldDomId}>{field.label}{field.required ? " *" : ""}</label>}
            {mode === "assigned" && assignmentId ? <IntakeFileField assignmentId={assignmentId} fieldKey={field.stable_field_key}
              label={field.label} id={fieldDomId} value={Array.isArray(answers[field.stable_field_key]) ? String((answers[field.stable_field_key] as Json[])[0] ?? "") || null : null}
              required={field.required} disabled={readonly || pending} onBusy={setUploading}
              onChange={(ids) => { revision.current++; setAnswers((current) => ({ ...current, [field.stable_field_key]: ids })); setDraftState("idle"); setDraftMessage("Unsaved changes. Save your progress before leaving."); }} />
              : <p>Images and PDFs up to 4 MB can be attached to assigned intake forms.</p>}
          </div>;
          if (["payment", "captcha", "calendly"].includes(field.field_type)) return <div className={styles.integrationNotice} key={field.stable_field_key}><ShieldAlert aria-hidden="true" /><div><strong>{field.label}</strong><span>{field.field_type === "payment" ? "Payment is configured separately and is not collected by this Form." : field.field_type === "captcha" ? "Captcha verification is not enabled." : "Scheduling is not connected; this field is presentation-only."}</span></div></div>;
          return <div className={styles.renderField} data-field-type={field.field_type} key={field.stable_field_key}>
            <label htmlFor={fieldDomId}>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>
            {field.help_html ? <div className={styles.fieldHelp} id={`${fieldDomId}-help`}>{agreementContent(field)
              ? <AgreementDisclosure id={`${fieldDomId}-agreement`}><div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /></AgreementDisclosure>
              : <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} />}</div> : null}
            <FieldControl field={field} id={fieldDomId} value={answers[field.stable_field_key]} disabled={readonly || pending} onChange={(value) => { revision.current++; setAnswers((current) => ({ ...current, [field.stable_field_key]: value })); setDraftState("idle"); setDraftMessage("Unsaved changes. Save your progress before leaving."); }} />
          </div>;
        })}
      </div>
      {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
      {draftError ? <div role="alert" className={styles.actionError}><p>{draftError}</p><button type="button" onClick={() => { setDraftLoading(true); setDraftError(null); setDraftLoadAttempt((attempt) => attempt + 1); }}>Retry saved draft</button></div> : null}
      {mode !== "preview" && mode !== "readonly" ? <footer className={styles.rendererFooter} data-state={draftState}>
        <div className={styles.rendererActions}>
          {supportsDraft ? <button className="button-secondary" type="button" onClick={saveDraft} aria-busy={draftState === "saving" || undefined} disabled={pending || readonly}>
            {draftState === "saving" ? <LoaderCircle className="spinner" aria-hidden="true" /> : draftState === "saved" ? <CheckCircle2 className={styles.savedCheck} aria-hidden="true" /> : null}
            {draftLoading ? "Restoring draft…" : draftState === "saving" ? "Saving draft…" : "Save and continue later"}
          </button> : null}
          <button className="button-primary" type="submit" aria-busy={pending || undefined} disabled={pending || readonly}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Submit Form</button>
        </div>
        {supportsDraft ? <p role="status">{draftState === "saving" ? "Saving your progress…" : draftMessage || "Save your progress before leaving this form."}</p> : null}
      </footer> : null}
    </form>
  );
}
