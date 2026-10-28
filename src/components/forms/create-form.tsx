"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createFormAction } from "../../app/actions/forms";
import type { CreateFormInput, FormDefinition } from "../../domain/forms/schema";
import type { ReviewedIntakeTemplate, ReviewedIntakeTemplateOption } from "../../lib/forms/reviewed-intake-templates";
import type { ServiceRow } from "../../lib/supabase/database-rows";
import { formTypeLabels } from "../../lib/forms/presentation";
import { ServicePicker, type PickerFolder } from "../services/service-picker";
import { AnimatedSelect } from "../ui/animated-select";
import styles from "./forms.module.css";

const types = ["order", "contact", "intake", "onboarding"] as const;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

export function CreateForm({ services, folders = [], reviewedTemplates = [], reviewedTemplate = null }: { services: ServiceRow[]; folders?: PickerFolder[]; reviewedTemplates?: ReviewedIntakeTemplateOption[]; reviewedTemplate?: ReviewedIntakeTemplate | null }) {
  const router = useRouter();
  const [formType, setFormType] = useState<(typeof types)[number]>(reviewedTemplate?.form_type ?? "order");
  const [name, setName] = useState(reviewedTemplate?.definition.name ?? "");
  const [canonicalKey, setCanonicalKey] = useState(reviewedTemplate?.canonical_key ?? "");
  const [serviceId, setServiceId] = useState("");
  const [slugEdited, setSlugEdited] = useState(Boolean(reviewedTemplate));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const visibility = formType === "intake" || formType === "onboarding" ? "assigned" : "public";
  const [blankFieldKey] = useState(() => crypto.randomUUID());
  const lastRequest = useRef<{ fingerprint: string; input: CreateFormInput } | null>(null);

  function create() {
    if (pending) return;
    const fieldType = formType === "intake" || formType === "onboarding" ? "text" : "fullname";
    const definition: FormDefinition = reviewedTemplate ? { ...reviewedTemplate.definition, name } : {
      name,
      title: name,
      information_html: "<p>Please complete the fields below.</p>",
      visibility,
      type_config: formType === "onboarding" ? { reuse_policy: "company_profile" } : {},
      fields: [{ stable_field_key: blankFieldKey, sort_order: 0, field_type: fieldType, label: "Untitled field", internal_label: "untitled_field", placeholder: null, help_html: null, default_value: null, required: false, settings: {}, options: [], service_links: [] }],
      rules: [],
      service_links: formType === "intake" && serviceId ? [{ service_id: serviceId, role: "intake_assignment", sort_order: 0, configuration: {} }] : [],
    };
    const intent = { form_type: formType, canonical_key: canonicalKey, definition };
    const fingerprint = JSON.stringify(intent);
    if (lastRequest.current?.fingerprint !== fingerprint) lastRequest.current = { fingerprint, input: { ...intent, request_id: crypto.randomUUID() } };
    const input = lastRequest.current.input;
    startTransition(async () => {
      setError(null);
      const result = await createFormAction(input);
      if (!result.ok) setError(result.error);
      else router.push(`/forms/${result.data.id}?created=1`);
    });
  }

  return <div className={styles.createRoot}>
    <Link href="/forms" className={styles.backLink}><ArrowLeft aria-hidden="true" />Back to Forms</Link>
    <header><span>New Form</span><h1>Choose the workflow this Form supports.</h1><p>The type sets safe visibility and field boundaries. You can shape the draft in the visual builder next.</p></header>
    {reviewedTemplates.length ? <section className={styles.createFields}><div className={styles.customField}><span>Reviewed intake template</span><AnimatedSelect name="reviewed_intake_template" label="Reviewed intake template" menuLabel="Reviewed intake templates" value={reviewedTemplate?.file ?? ""} disabled={pending} options={[{ value: "", label: "Start with a blank Form" }, ...reviewedTemplates.map((template) => ({ value: template.file, label: template.label, description: `${template.fieldCount} fields · ${template.serviceCount} linked services` }))]} onChange={(file) => startTransition(() => router.push(file ? `/forms/new?template=${encodeURIComponent(file)}` : "/forms/new"))} /></div><p className={styles.intakeServiceHelp}>{reviewedTemplates.length} reviewed templates match your available Services. Selecting one prepares a draft; use Create draft to save it.</p></section> : null}
    <div className={styles.typeChoices}>{types.map((type) => <button key={type} type="button" data-selected={formType === type} disabled={pending || Boolean(reviewedTemplate)} onClick={() => setFormType(type)}><strong>{formTypeLabels[type]}</strong><span>{type === "order" ? "Collect service choices and order configuration." : type === "contact" ? "Collect a published inquiry without creating a Ticket yet." : type === "intake" ? "Assign to a Project with a linked Service." : "Assign directly to a client company."}</span></button>)}</div>
    <section className={styles.createFields}><label><span>Form name</span><input autoFocus value={name} disabled={pending} onChange={(event) => { const next = event.currentTarget.value; setName(next); if (!slugEdited) setCanonicalKey(slugify(next)); }} placeholder="Client onboarding" maxLength={200} /></label><label><span>Public slug</span><div><b aria-hidden="true">/f/</b><input aria-label="Public slug" value={canonicalKey} disabled={pending} onChange={(event) => { setSlugEdited(true); setCanonicalKey(slugify(event.currentTarget.value)); }} placeholder="client-onboarding" /></div></label>{formType === "intake" && !reviewedTemplate ? <div className={styles.customField}><span>Intake Service</span><ServicePicker label="Intake Service" folders={folders} services={services} value={serviceId} onChange={setServiceId} disabled={pending} /></div> : null}<dl><div><dt>Visibility</dt><dd>{visibility === "assigned" ? "Assigned only" : "Public (editable in builder)"}</dd></div><div><dt>Initial state</dt><dd>Draft</dd></div>{reviewedTemplate ? <div><dt>Reviewed content</dt><dd>{reviewedTemplate.definition.fields.length} fields · {reviewedTemplate.definition.service_links.length} linked services</dd></div> : null}</dl></section>
    {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
    <footer><button className="button-primary" type="button" aria-busy={pending || undefined} disabled={pending || !name.trim() || !canonicalKey || (formType === "intake" && !serviceId && !reviewedTemplate)} onClick={create}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Create draft <ArrowRight aria-hidden="true" /></button></footer>
  </div>;
}
