"use client";

import { CheckCircle2, FileLock2, LoaderCircle, ShieldAlert } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { submitAssignedFormAction, submitPublicFormAction } from "../../app/actions/forms";
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
  value,
  onChange,
  disabled,
}: {
  field: FormPublishedSchema["fields"][number];
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
}) {
  const id = `form-field-${field.stable_field_key}`;
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
    return <select {...common} value={stringValue} onChange={(event) => onChange(event.currentTarget.value)}><option value="">Select an option</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select>;
  }
  if (["data-option-group", "optgroup"].includes(field.field_type)) {
    const choices = field.field_type === "optgroup"
      ? field.services.map((service) => ({ id: service.service_id, label: service.name }))
      : field.options.map((option) => ({ id: option.option_id, label: option.label }));
    return <div className={styles.optionGroup}>{choices.map((choice) => <label key={choice.id}><input type="radio" name={field.stable_field_key} value={choice.id} checked={stringValue === choice.id} disabled={disabled} onChange={() => onChange(choice.id)} /><span>{choice.label}</span></label>)}</div>;
  }
  return <input {...common} type={field.field_type === "email" ? "email" : field.field_type === "date" ? "date" : field.field_type === "phone" ? "tel" : "text"} value={stringValue} onChange={(event) => onChange(event.currentTarget.value)} />;
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
  const readonly = mode === "preview" || mode === "readonly" || completed || result != null;
  const fields = useMemo(() => [...schema.fields].sort((a, b) => a.sort_order - b.sort_order), [schema.fields]);

  function submit() {
    if (readonly || pending) return;
    setError(null);
    const values: SubmitFormInput["values"] = fields
      .filter((field) => !structuralTypes.has(field.field_type) && isFormFieldVisible(field.stable_field_key, schema.rules, answers))
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
      if (!response.ok) setError(response.error);
      else setResult(response.data);
    });
  }

  if (result || completed) {
    return <section className={styles.formComplete}><CheckCircle2 aria-hidden="true" /><h2>{completed ? "Completed" : "Submitted"}</h2><p>Your responses are safely recorded against Form Version {schema.version_number}.</p></section>;
  }

  return (
    <form className={styles.renderer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {mode === "preview" ? <div className={styles.previewFlag}>Draft Preview</div> : null}
      <header className={styles.rendererHeader}>
        <span>{schema.form_type} form · Version {schema.version_number}</span>
        <h1>{schema.title}</h1>
        {schema.information_html ? <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(schema.information_html) }} /> : null}
      </header>
      <div className={styles.rendererFields}>
        {fields.map((field) => {
          if (!isFormFieldVisible(field.stable_field_key, schema.rules, answers)) return null;
          if (field.field_type === "break") return <section className={styles.sectionBreak} key={field.stable_field_key}><h2>{field.label}</h2></section>;
          if (field.field_type === "pagebreak") return <div className={styles.pageBreak} key={field.stable_field_key}><span>{field.label}</span></div>;
          if (field.field_type === "html") return <div className={styles.safeHtml} key={field.stable_field_key} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(typeof field.settings.html === "string" ? field.settings.html : "") }} />;
          if (field.field_type === "hidden") return null;
          if (field.field_type === "secret") return <div className={styles.integrationNotice} key={field.stable_field_key}><FileLock2 aria-hidden="true" /><div><strong>{field.label}</strong><span>Secure secret collection is unavailable until encrypted storage is connected.</span></div></div>;
          if (field.field_type === "file") return <div className={styles.integrationNotice} key={field.stable_field_key}><FileLock2 aria-hidden="true" /><div><strong>{field.label}</strong><span>File upload is not enabled. No file will be collected.</span></div></div>;
          if (["payment", "captcha", "calendly"].includes(field.field_type)) return <div className={styles.integrationNotice} key={field.stable_field_key}><ShieldAlert aria-hidden="true" /><div><strong>{field.label}</strong><span>{field.field_type === "payment" ? "Payment is configured separately and is not collected by this Form." : field.field_type === "captcha" ? "Captcha verification is not enabled." : "Scheduling is not connected; this field is presentation-only."}</span></div></div>;
          return <div className={styles.renderField} key={field.stable_field_key}>
            <label htmlFor={`form-field-${field.stable_field_key}`}>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</label>
            {field.help_html ? <div className={styles.fieldHelp} dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(field.help_html) }} /> : null}
            <FieldControl field={field} value={answers[field.stable_field_key]} disabled={readonly || pending} onChange={(value) => setAnswers((current) => ({ ...current, [field.stable_field_key]: value }))} />
          </div>;
        })}
      </div>
      {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
      {mode !== "preview" && mode !== "readonly" ? <footer className={styles.rendererFooter}><button className="button-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Submit Form</button><span>Submission is saved to Version {schema.version_number}.</span></footer> : null}
    </form>
  );
}
