"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createFormAction } from "../../app/actions/forms";
import type { FormDefinition } from "../../domain/forms/schema";
import type { ServiceRow } from "../../lib/supabase/database-rows";
import { formTypeLabels } from "../../lib/forms/presentation";
import { SearchableSelect } from "../ui/searchable-select";
import styles from "./forms.module.css";

const types = ["order", "contact", "intake", "onboarding"] as const;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

export function CreateForm({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  const [formType, setFormType] = useState<(typeof types)[number]>("order");
  const [name, setName] = useState("");
  const [canonicalKey, setCanonicalKey] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const visibility = formType === "intake" || formType === "onboarding" ? "assigned" : "public";
  const requestId = useMemo(() => crypto.randomUUID(), []);

  function create() {
    const fieldType = formType === "intake" || formType === "onboarding" ? "text" : "fullname";
    const definition: FormDefinition = {
      name,
      title: name,
      information_html: "<p>Please complete the fields below.</p>",
      visibility,
      type_config: formType === "onboarding" ? { reuse_policy: "company_profile" } : {},
      fields: [{ stable_field_key: crypto.randomUUID(), sort_order: 0, field_type: fieldType, label: "Untitled field", internal_label: "untitled_field", placeholder: null, help_html: null, default_value: null, required: false, settings: {}, options: [], service_links: [] }],
      rules: [],
      service_links: formType === "intake" && serviceId ? [{ service_id: serviceId, role: "intake_assignment", sort_order: 0, configuration: {} }] : [],
    };
    startTransition(async () => {
      setError(null);
      const result = await createFormAction({ request_id: requestId, form_type: formType, canonical_key: canonicalKey, definition });
      if (!result.ok) setError(result.error);
      else router.push(`/forms/${result.data.id}?created=1`);
    });
  }

  return <div className={styles.createRoot}>
    <Link href="/forms" className={styles.backLink}><ArrowLeft aria-hidden="true" />Back to Forms</Link>
    <header><span>New Form</span><h1>Choose the workflow this Form supports.</h1><p>The type sets safe visibility and field boundaries. You can shape the draft in the visual builder next.</p></header>
    <div className={styles.typeChoices}>{types.map((type) => <button key={type} type="button" data-selected={formType === type} onClick={() => setFormType(type)}><strong>{formTypeLabels[type]}</strong><span>{type === "order" ? "Collect service choices and order configuration." : type === "contact" ? "Collect a published inquiry without creating a Ticket yet." : type === "intake" ? "Assign to a Project with a linked Service." : "Assign directly to a client company."}</span></button>)}</div>
    <section className={styles.createFields}><label><span>Form name</span><input autoFocus value={name} onChange={(event) => { const next = event.currentTarget.value; setName(next); if (!slugEdited) setCanonicalKey(slugify(next)); }} placeholder="Client onboarding" maxLength={200} /></label><label><span>Public slug</span><div><b>/f/</b><input value={canonicalKey} onChange={(event) => { setSlugEdited(true); setCanonicalKey(slugify(event.currentTarget.value)); }} placeholder="client-onboarding" /></div></label>{formType === "intake" ? <label><span>Intake Service</span><SearchableSelect name="service_id" label="Intake Service" options={services.map((service) => ({ id: service.id, label: service.name }))} value={serviceId} onChange={setServiceId} placeholder="Search services..." menuLabel="Intake Service" required /></label> : null}<dl><div><dt>Visibility</dt><dd>{visibility === "assigned" ? "Assigned only" : "Public (editable in builder)"}</dd></div><div><dt>Initial state</dt><dd>Draft</dd></div></dl></section>
    {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
    <footer><button className="button-primary" type="button" aria-busy={pending || undefined} disabled={pending || !name.trim() || !canonicalKey || (formType === "intake" && !serviceId)} onClick={create}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Create draft <ArrowRight aria-hidden="true" /></button></footer>
  </div>;
}
