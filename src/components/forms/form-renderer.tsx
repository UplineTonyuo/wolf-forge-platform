"use client";

import { CheckCircle2, FileLock2, LoaderCircle, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { loadFormCollectionAvailability, submitAssignedFormAction, submitPublicFormAction } from "../../app/actions/forms";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import type { FormPublishedSchema, SubmitFormInput } from "../../domain/forms/schema";
import type { Json } from "../../lib/supabase/database.types";
import { sanitizeFormHtml } from "../../lib/forms/presentation";
import styles from "./forms.module.css";

type AnswerMap = Record<string, Json | undefined>;

const structuralTypes = new Set(["payment", "hidden", "break", "pagebreak", "html", "file", "secret", "captcha"]);

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
  };
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

export function FormRenderer({
  schema,
  mode = "preview",
  assignmentId,
  completed = false,
}: {
  schema: FormPublishedSchema;
  mode?: "preview" | "assigned" | "public" | "readonly";
  assignmentId?: string;
  completed?: boolean;
}) {
  const [answers, setAnswers] = useState<AnswerMap>(() => Object.fromEntries(schema.fields.map((field) => [field.stable_field_key, field.default_value ?? (field.field_type === "checkbox" ? false : "")])));
  const [requestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (mode !== "assigned" && mode !== "public") return;
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const enabled = await loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id);
        if (!disposed) setAvailable(enabled);
      } finally { checking = false; }
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, 15000);
    window.addEventListener("focus", check);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [mode, schema.canonical_key, schema.form_version_id]);
  const readonly = mode === "preview" || mode === "readonly" || completed || result != null || !available;
  const fields = useMemo(() => [...schema.fields].sort((a, b) => a.sort_order - b.sort_order), [schema.fields]);

  function submit() {
    if (readonly || pending) return;
    const missingChoice = fields.find((field) => field.required
      && ["date", "dropdown", "data-dropdown"].includes(field.field_type)
      && isFormFieldVisible(field.stable_field_key, schema.rules, answers)
      && !answers[field.stable_field_key]);
    if (missingChoice) {
      setError(`Choose a value for ${missingChoice.label}.`);
      document.getElementsByName(missingChoice.stable_field_key).item(0)
        ?.parentElement?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    setError(null);
    const values: SubmitFormInput["values"] = fields
      .filter((field) => !structuralTypes.has(field.field_type) && isFormFieldVisible(field.stable_field_key, schema.rules, answers))
      .filter((field) => {
        const answer = answers[field.stable_field_key];
        return field.required || (answer !== undefined && answer !== null && answer !== "");
      })
      .map((field) => ({ field_key: field.stable_field_key, value: (answers[field.stable_field_key] ?? null) as SubmitFormInput["values"][number]["value"] }));
    const input: SubmitFormInput = {
      request_id: requestId,
      form_version_id: schema.form_version_id,
      context: assignmentId ? { assignment_id: assignmentId } : {},
      values,
      files: [],
    };
    startTransition(async () => {
      const response = mode === "assigned"
        ? await submitAssignedFormAction(input)
        : await submitPublicFormAction(input);
      if (!response.ok) {
        setError(response.error);
        setAvailable(await loadFormCollectionAvailability(schema.canonical_key, schema.form_version_id));
      }
      else setResult(response.data);
    });
  }

  if (result || completed) {
    return <section className={styles.formComplete}><CheckCircle2 aria-hidden="true" /><h2>{completed ? "Completed" : "Submitted"}</h2><p>Your responses are safely recorded against Form Version {schema.version_number}.</p></section>;
  }

  if (!available) return <section className={styles.formComplete} role="status"><FileLock2 aria-hidden="true" /><h2>Form collection is unavailable</h2><p>Outstanding requests and previously submitted responses are retained.</p></section>;

  return (
    <form className={styles.renderer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {mode === "preview" ? <div className={styles.previewFlag}>Draft Preview</div> : null}
      <header className={styles.rendererHeader}>
        <span>{schema.form_type} form · Version {schema.version_number}</span>
        <h1>{schema.title}</h1>
        {schema.information_html ? <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(schema.information_html) }} /> : null}
      </header>
      <div className={styles.rendererFields}>
        {fields.map((field, fieldIndex) => {
          const fieldDomId = `form-field-${fieldIndex}`;
          if (!isFormFieldVisible(field.stable_field_key, schema.rules, answers)) return null;
          if (field.field_type === "break") return <section className={styles.sectionBreak} key={field.stable_field_key}><h2>{field.label}</h2></section>;
          if (field.field_type === "pagebreak") return <div className={styles.pageBreak} key={field.stable_field_key}><span>{field.label}</span></div>;
          if (field.field_type === "html") return <div className={styles.safeHtml} key={field.stable_field_key} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(typeof field.settings.html === "string" ? field.settings.html : "") }} />;
          if (field.field_type === "hidden") return null;
          if (field.field_type === "secret") return <div className={styles.integrationNotice} key={field.stable_field_key}><FileLock2 aria-hidden="true" /><div><strong>{field.label}</strong><span>Secure secret collection is unavailable until encrypted storage is connected.</span></div></div>;
          if (field.field_type === "file") return <div className={styles.integrationNotice} key={field.stable_field_key}><FileLock2 aria-hidden="true" /><div><strong>{field.label}</strong><span>File upload is not enabled. No file will be collected.</span></div></div>;
          if (["payment", "captcha", "calendly"].includes(field.field_type)) return <div className={styles.integrationNotice} key={field.stable_field_key}><ShieldAlert aria-hidden="true" /><div><strong>{field.label}</strong><span>{field.field_type === "payment" ? "Payment is configured separately and is not collected by this Form." : field.field_type === "captcha" ? "Captcha verification is not enabled." : "Scheduling is not connected; this field is presentation-only."}</span></div></div>;
          return <div className={styles.renderField} key={field.stable_field_key}>
            <label htmlFor={fieldDomId}>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>
            {field.help_html ? <div className={styles.fieldHelp} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /> : null}
            <FieldControl field={field} id={fieldDomId} value={answers[field.stable_field_key]} disabled={readonly || pending} onChange={(value) => setAnswers((current) => ({ ...current, [field.stable_field_key]: value }))} />
          </div>;
        })}
      </div>
      {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
      {mode !== "preview" && mode !== "readonly" ? <footer className={styles.rendererFooter}><button className="button-primary" type="submit" aria-busy={pending || undefined} disabled={pending}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Submit Form</button><span>Submission is saved to Version {schema.version_number}.</span></footer> : null}
    </form>
  );
}
