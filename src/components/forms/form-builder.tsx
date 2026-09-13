"use client";

import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, CalendarDays, CheckSquare, ChevronDown,
  CircleDot, Code2, Copy, Eye, FileText, GripVertical, Heading2, LayoutList, LoaderCircle,
  Mail, MapPin, Minus, MoveDown, MoveUp, Plus, Save, Send, Settings2, ShieldAlert,
  Signature, Smartphone, Trash2, Type, Upload, UserRound, X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { archiveFormAction, publishFormAction, saveFormDraftAction } from "../../app/actions/forms";
import type { FormCapabilities, FormDefinition, FormDetail, FormPublishedSchema } from "../../domain/forms/schema";
import type { FormVersionRow, ServiceRow } from "../../lib/supabase/database-rows";
import { fieldTypeLabels, sanitizeFormHtml } from "../../lib/forms/presentation";
import { FormRenderer } from "./form-renderer";
import styles from "./forms.module.css";

type Field = FormDefinition["fields"][number];
type FieldType = Field["field_type"];
type PaletteItem = { type: FieldType; icon: LucideIcon };

const palette: Array<{ label: string; items: PaletteItem[] }> = [
  { label: "Basic", items: [
    { type: "text", icon: Type }, { type: "textarea", icon: AlignLeft }, { type: "fullname", icon: UserRound },
    { type: "email", icon: Mail }, { type: "phone", icon: Smartphone }, { type: "address", icon: MapPin },
    { type: "date", icon: CalendarDays }, { type: "checkbox", icon: CheckSquare },
  ] },
  { label: "Choice", items: [{ type: "data-option-group", icon: CircleDot }, { type: "data-dropdown", icon: ChevronDown }] },
  { label: "Content", items: [{ type: "richtext", icon: FileText }, { type: "break", icon: Heading2 }, { type: "pagebreak", icon: Minus }, { type: "html", icon: Code2 }] },
  { label: "Advanced", items: [{ type: "file", icon: Upload }, { type: "data-spreadsheet", icon: LayoutList }, { type: "signature", icon: Signature }, { type: "hidden", icon: ShieldAlert }, { type: "secret", icon: ShieldAlert }, { type: "calendly", icon: CalendarDays }, { type: "captcha", icon: ShieldAlert }] },
  { label: "Order only", items: [{ type: "optgroup", icon: CircleDot }, { type: "dropdown", icon: ChevronDown }, { type: "payment", icon: ShieldAlert }] },
];

function fieldAllowed(type: FieldType, formType: FormDetail["form"]["form_type"]) {
  if (["optgroup", "dropdown", "payment"].includes(type)) return formType === "order";
  if (["fullname", "email", "password", "address", "phone", "optin"].includes(type)) return formType === "order" || formType === "contact";
  if (type === "captcha") return formType !== "onboarding";
  return true;
}

function makeField(type: FieldType, services: ServiceRow[]): Field {
  const choice = type === "data-option-group" || type === "data-dropdown";
  const serviceChoice = type === "optgroup" || type === "dropdown";
  return {
    stable_field_key: crypto.randomUUID(),
    sort_order: 0,
    field_type: type,
    label: fieldTypeLabels[type] ?? "Field",
    internal_label: `${type.replaceAll("-", "_")}_${Date.now()}`,
    placeholder: null,
    help_html: null,
    default_value: null,
    required: false,
    settings: type === "secret" ? { collection_mode: "disabled" } : type === "html" ? { html: "<p>Formatted content</p>" } : {},
    options: choice ? ["Option 1", "Option 2"].map((label, index) => ({ stable_option_key: crypto.randomUUID(), option_value: `option-${index + 1}`, label, sort_order: index, metadata: {} })) : [],
    service_links: serviceChoice && services[0] ? [{ service_id: services[0].id, role: "offered_item", sort_order: 0, configuration: {} }] : [],
  };
}

function normalize(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    fields: definition.fields.map((field, sort_order) => ({ ...field, sort_order, options: field.options.map((option, optionSort) => ({ ...option, sort_order: optionSort })), service_links: field.service_links.map((link, linkSort) => ({ ...link, sort_order: linkSort })) })),
    rules: definition.rules.map((rule, sort_order) => ({ ...rule, sort_order })),
    service_links: definition.service_links.map((link, sort_order) => ({ ...link, sort_order })),
  };
}

function previewSchema(detail: FormDetail, definition: FormDefinition, services: ServiceRow[]): FormPublishedSchema {
  const draft = detail.versions.find((version) => version.id === detail.form.current_draft_version_id);
  return {
    form_id: detail.form.id,
    form_type: detail.form.form_type,
    canonical_key: detail.form.canonical_key,
    form_version_id: draft?.id ?? detail.form.current_draft_version_id ?? detail.form.id,
    version_number: draft?.version_number ?? 1,
    schema_hash: null,
    title: definition.title,
    information_html: definition.information_html ?? null,
    visibility: definition.visibility,
    type_config: definition.type_config,
    fields: definition.fields.map((field) => ({
      stable_field_key: field.stable_field_key, sort_order: field.sort_order, field_type: field.field_type,
      label: field.label, placeholder: field.placeholder ?? null, help_html: field.help_html ?? null,
      default_value: field.default_value ?? null, required: field.required, settings: field.settings,
      options: field.options.map((option) => ({ option_id: option.stable_option_key, value: option.option_value, label: option.label, sort_order: option.sort_order, metadata: option.metadata })),
      services: field.service_links.map((link) => { const service = services.find((item) => item.id === link.service_id); return { service_id: link.service_id, role: link.role, sort_order: link.sort_order, configuration: link.configuration, name: service?.name ?? "Service", currency: service?.currency ?? "USD", price_cents: Math.round((service?.price ?? 0) * 100) }; }),
    })),
    rules: definition.rules,
  };
}

function VersionHistory({ versions, formId }: { versions: FormVersionRow[]; formId: string }) {
  return <section className={styles.versionHistory} id="versions"><header><div><span>Immutable history</span><h2>Versions</h2></div></header><ol>{[...versions].sort((a, b) => b.version_number - a.version_number).map((version) => <li key={version.id}><div><strong>{version.lifecycle_state === "draft" ? "Current draft" : `Version ${version.version_number}`}</strong><span>{version.lifecycle_state === "published" ? `Published ${version.published_at ? new Date(version.published_at).toLocaleDateString() : ""}` : "Editable working version"}</span></div><span className={styles.status} data-state={version.lifecycle_state}>{version.lifecycle_state}</span>{version.lifecycle_state === "published" ? <Link href={`/forms/${formId}/versions/${version.id}`}>View</Link> : null}</li>)}</ol></section>;
}

function LogicEditor({
  definition,
  selectedKey,
  setDefinition,
}: {
  definition: FormDefinition;
  selectedKey: string;
  setDefinition: Dispatch<SetStateAction<FormDefinition>>;
}) {
  const available = definition.fields.filter((field) => field.stable_field_key !== selectedKey);
  const targeted = definition.rules.filter((rule) => rule.target_field_keys.includes(selectedKey));
  function updateRule(ruleKey: string, updater: (rule: FormDefinition["rules"][number]) => FormDefinition["rules"][number]) {
    setDefinition((current) => ({ ...current, rules: current.rules.map((rule) => rule.rule_key === ruleKey ? updater(rule) : rule) }));
  }
  return <section className={styles.logicEditor}>
    <header><h3>Conditional visibility</h3><span>Simple AND rules</span></header>
    {targeted.map((rule) => <div key={rule.rule_key} className={styles.logicRule}>
      {rule.conditions.map((condition, index) => <div key={`${rule.rule_key}-${index}`} className={styles.logicCondition}>
        <span>{index === 0 ? "If" : "And"}</span>
        <select aria-label={index === 0 ? "Condition field" : `Condition field ${index + 1}`} value={condition.field_key} onChange={(event) => { const value = event.target.value; updateRule(rule.rule_key, (current) => ({ ...current, conditions: current.conditions.map((item, conditionIndex) => conditionIndex === index ? { ...item, field_key: value } : item) })); }}>{available.map((field) => <option key={field.stable_field_key} value={field.stable_field_key}>{field.label}</option>)}</select>
        <select aria-label={index === 0 ? "Comparator" : `Comparator ${index + 1}`} value={condition.comparator} onChange={(event) => { const value = event.target.value as typeof condition.comparator; updateRule(rule.rule_key, (current) => ({ ...current, conditions: current.conditions.map((item, conditionIndex) => conditionIndex === index ? { ...item, comparator: value } : item) })); }}><option value="equals">equals</option><option value="not_equals">does not equal</option><option value="checked">is checked</option><option value="not_checked">is not checked</option></select>
        {!(["checked", "not_checked"].includes(condition.comparator)) ? <input aria-label={index === 0 ? "Condition value" : `Condition value ${index + 1}`} value={typeof condition.value === "string" ? condition.value : ""} onChange={(event) => { const value = event.target.value; updateRule(rule.rule_key, (current) => ({ ...current, conditions: current.conditions.map((item, conditionIndex) => conditionIndex === index ? { ...item, value } : item) })); }} /> : null}
        {rule.conditions.length > 1 ? <button type="button" onClick={() => updateRule(rule.rule_key, (current) => ({ ...current, conditions: current.conditions.filter((_item, conditionIndex) => conditionIndex !== index) }))}>Remove condition</button> : null}
      </div>)}
      <select aria-label="Visibility action" value={rule.action} onChange={(event) => { const value = event.target.value as "show" | "hide"; updateRule(rule.rule_key, (current) => ({ ...current, action: value })); }}><option value="show">Show field</option><option value="hide">Hide field</option></select>
      <div className={styles.logicButtons}>{available.length ? <button type="button" onClick={() => updateRule(rule.rule_key, (current) => ({ ...current, conditions: [...current.conditions, { field_key: available[0]!.stable_field_key, comparator: "equals", value: "" }] }))}>Add AND condition</button> : null}<button type="button" onClick={() => setDefinition((current) => ({ ...current, rules: current.rules.filter((item) => item.rule_key !== rule.rule_key) }))}>Remove rule</button></div>
    </div>)}
    {available.length > 0 && targeted.length === 0 ? <button type="button" className={styles.addRule} onClick={() => setDefinition((current) => ({ ...current, rules: [...current.rules, { rule_key: crypto.randomUUID(), sort_order: current.rules.length, conditions: [{ field_key: available[0]!.stable_field_key, comparator: "equals", value: "" }], action: "show", target_field_keys: [selectedKey] }] }))}><Plus aria-hidden="true" />Add condition</button> : null}
  </section>;
}

export function FormBuilder({ detail, capabilities, services }: { detail: FormDetail; capabilities: FormCapabilities; services: ServiceRow[] }) {
  const router = useRouter();
  const [definition, setDefinition] = useState<FormDefinition>(() => normalize(detail.draftDefinition));
  const [selectedKey, setSelectedKey] = useState(definition.fields[0]?.stable_field_key ?? null);
  const [mobilePanel, setMobilePanel] = useState<"palette" | "settings" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [message, setMessage] = useState("Draft loaded");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = definition.fields.find((field) => field.stable_field_key === selectedKey) ?? null;
  const schema = useMemo(() => previewSchema(detail, normalize(definition), services), [definition, detail, services]);

  function updateField(update: (field: Field) => Field) {
    if (!selectedKey) return;
    setDefinition((current) => ({ ...current, fields: current.fields.map((field) => field.stable_field_key === selectedKey ? update(field) : field) }));
    setMessage("Unsaved changes");
  }

  function addField(type: FieldType) {
    const field = makeField(type, services);
    setDefinition((current) => normalize({ ...current, fields: [...current.fields, field] }));
    setSelectedKey(field.stable_field_key);
    setMobilePanel(null);
    setMessage("Unsaved changes");
  }

  function moveField(key: string, delta: number) {
    setDefinition((current) => {
      const fields = [...current.fields];
      const index = fields.findIndex((field) => field.stable_field_key === key);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= fields.length) return current;
      [fields[index], fields[next]] = [fields[next]!, fields[index]!];
      return normalize({ ...current, fields });
    });
    setMessage("Unsaved changes");
  }

  function save(onSaved?: () => Promise<void> | void) {
    if (pending) return;
    const requestId = crypto.randomUUID();
    startTransition(async () => {
      setError(null);
      setMessage("Saving draft…");
      const result = await saveFormDraftAction(detail.form.id, { request_id: requestId, definition: normalize(definition) });
      if (!result.ok) { setError(result.error); setMessage("Draft not saved"); return; }
      setMessage(`Draft Version ${result.data.version} saved`);
      await onSaved?.();
    });
  }

  function publish() {
    save(async () => {
      const result = await publishFormAction(detail.form.id, crypto.randomUUID());
      if (!result.ok) { setError(result.error); return; }
      setPublishOpen(false);
      setMessage(`Version ${result.data.version} published`);
      router.refresh();
    });
  }

  function archive() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await archiveFormAction(detail.form.id, crypto.randomUUID());
      if (!result.ok) { setError(result.error); return; }
      setArchiveOpen(false);
      setMessage("Form archived");
      router.refresh();
    });
  }

  const palettePanel = <aside className={styles.palette} data-mobile-open={mobilePanel === "palette"}><header><h2>Add fields</h2><button type="button" className={styles.mobileClose} onClick={() => setMobilePanel(null)} aria-label="Close field palette"><X aria-hidden="true" /></button></header>{palette.map((group) => { const items = group.items.filter((item) => fieldAllowed(item.type, detail.form.form_type)); if (!items.length) return null; return <section key={group.label}><h3>{group.label}</h3><div>{items.map(({ type, icon: Icon }) => <button type="button" key={type} onClick={() => addField(type)}><Icon aria-hidden="true" /><span>{fieldTypeLabels[type]}</span></button>)}</div></section>; })}</aside>;

  const settingsPanel = <aside className={styles.settings} data-mobile-open={mobilePanel === "settings"}><header><div><span>Field</span><h2>{selected ? fieldTypeLabels[selected.field_type] : "Form settings"}</h2></div><button type="button" className={styles.mobileClose} onClick={() => setMobilePanel(null)} aria-label="Close settings"><X aria-hidden="true" /></button></header>{selected ? <div className={styles.settingsBody}>
    <label><span>Label</span><input value={selected.label} onChange={(event) => updateField((field) => ({ ...field, label: event.target.value }))} /></label>
    <label><span>Internal label</span><input value={selected.internal_label ?? ""} onChange={(event) => updateField((field) => ({ ...field, internal_label: event.target.value || null }))} /></label>
    <label><span>Placeholder</span><input value={selected.placeholder ?? ""} onChange={(event) => updateField((field) => ({ ...field, placeholder: event.target.value || null }))} /></label>
    <label><span>Help text</span><textarea rows={3} value={selected.help_html ?? ""} onChange={(event) => updateField((field) => ({ ...field, help_html: event.target.value || null }))} /></label>
    {!(["password", "secret", "file", "captcha", "payment", "hidden", "break", "pagebreak", "html"].includes(selected.field_type)) ? <label className={styles.toggle}><input type="checkbox" checked={selected.required} onChange={(event) => updateField((field) => ({ ...field, required: event.target.checked }))} /><span><strong>Required</strong><small>Make this response mandatory.</small></span></label> : null}
    {selected.field_type === "html" ? <label><span>Safe HTML</span><textarea rows={5} value={typeof selected.settings.html === "string" ? selected.settings.html : ""} onChange={(event) => updateField((field) => ({ ...field, settings: { ...field.settings, html: event.target.value } }))} /><small>Scripts, embeds, event handlers, and unsafe protocols are rejected.</small></label> : null}
    {["secret", "file", "payment", "captcha", "calendly"].includes(selected.field_type) ? <p className={styles.safetyNote}><ShieldAlert aria-hidden="true" />{selected.field_type === "secret" ? "Collection is disabled until encrypted storage exists." : selected.field_type === "file" ? "Upload execution is not enabled." : `${fieldTypeLabels[selected.field_type]} is configuration-only in this phase.`}</p> : null}
    {["data-option-group", "data-dropdown"].includes(selected.field_type) ? <section className={styles.optionsEditor}><header><h3>Options</h3><button type="button" onClick={() => updateField((field) => ({ ...field, options: [...field.options, { stable_option_key: crypto.randomUUID(), option_value: `option-${field.options.length + 1}`, label: `Option ${field.options.length + 1}`, sort_order: field.options.length, metadata: {} }] }))}><Plus aria-hidden="true" />Add</button></header>{selected.options.map((option, index) => <div key={option.stable_option_key}><GripVertical aria-hidden="true" /><input aria-label={`Option ${index + 1}`} value={option.label} onChange={(event) => updateField((field) => ({ ...field, options: field.options.map((item) => item.stable_option_key === option.stable_option_key ? { ...item, label: event.target.value } : item) }))} /><button type="button" aria-label="Move option up" disabled={index === 0} onClick={() => updateField((field) => { const options = [...field.options]; [options[index - 1], options[index]] = [options[index]!, options[index - 1]!]; return { ...field, options }; })}><ArrowUp aria-hidden="true" /></button><button type="button" aria-label="Move option down" disabled={index === selected.options.length - 1} onClick={() => updateField((field) => { const options = [...field.options]; [options[index], options[index + 1]] = [options[index + 1]!, options[index]!]; return { ...field, options }; })}><ArrowDown aria-hidden="true" /></button><button type="button" aria-label="Remove option" disabled={selected.options.length <= 1} onClick={() => updateField((field) => ({ ...field, options: field.options.filter((item) => item.stable_option_key !== option.stable_option_key) }))}><Trash2 aria-hidden="true" /></button></div>)}</section> : null}
    {["optgroup", "dropdown"].includes(selected.field_type) ? <fieldset className={styles.servicePicker}><legend>Available Services</legend>{services.map((service) => <label key={service.id}><input type="checkbox" checked={selected.service_links.some((link) => link.service_id === service.id)} onChange={(event) => updateField((field) => ({ ...field, service_links: event.target.checked ? [...field.service_links, { service_id: service.id, role: "offered_item", sort_order: field.service_links.length, configuration: {} }] : field.service_links.filter((link) => link.service_id !== service.id) }))} /><span>{service.name}</span></label>)}</fieldset> : null}
    <LogicEditor definition={definition} selectedKey={selected.stable_field_key} setDefinition={setDefinition} />
  </div> : <p className={styles.settingsEmpty}>Select a field on the canvas to configure it.</p>}</aside>;

  return <div className={styles.builderRoot}>
    <header className={styles.builderTop}><div><Link href="/forms"><ArrowLeft aria-hidden="true" />Forms</Link><span className={styles.status} data-state={detail.form.status}>{detail.form.status}</span><h1>{definition.name}</h1></div><div className={styles.builderActions}><button className="button-secondary" type="button" onClick={() => setPreviewOpen(true)}><Eye aria-hidden="true" />Preview</button>{capabilities.manage ? <button className="button-secondary" type="button" onClick={() => save()} aria-busy={pending || undefined} disabled={pending}><Save aria-hidden="true" />Save draft</button> : null}{capabilities.publish ? <button className="button-primary" type="button" onClick={() => setPublishOpen(true)}><Send aria-hidden="true" />Publish</button> : null}</div></header>
    {error ? <p className={styles.builderError} role="alert">{error}</p> : null}
    <section className={styles.formSettingsBar}><label><span>Form name</span><input value={definition.name} onChange={(event) => { const value = event.target.value; setDefinition((current) => ({ ...current, name: value })); setMessage("Unsaved changes"); }} /></label><label><span>Title</span><input value={definition.title} onChange={(event) => { const value = event.target.value; setDefinition((current) => ({ ...current, title: value })); setMessage("Unsaved changes"); }} /></label><label><span>Visibility</span><select value={definition.visibility} disabled={["intake", "onboarding"].includes(detail.form.form_type)} onChange={(event) => { const value = event.target.value as FormDefinition["visibility"]; setDefinition((current) => ({ ...current, visibility: value })); }}><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="assigned">Assigned</option></select></label>{detail.form.form_type === "intake" ? <label><span>Intake Services</span><select aria-label="Intake Service" value={definition.service_links[0]?.service_id ?? ""} onChange={(event) => { const value = event.target.value; setDefinition((current) => ({ ...current, service_links: value ? [{ service_id: value, role: "intake_assignment", sort_order: 0, configuration: {} }] : [] })); }}><option value="">Choose Service</option>{services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label> : null}</section>
    <div className={styles.mobileBuilderTools}><button type="button" onClick={() => setMobilePanel("palette")}><Plus aria-hidden="true" />Add field</button><button type="button" onClick={() => setMobilePanel("settings")}><Settings2 aria-hidden="true" />Field settings</button></div>
    <div className={styles.builderGrid}>{palettePanel}<main className={styles.canvas}><div className={styles.canvasPage}><header><span>Page 1</span><h2>{definition.title}</h2>{definition.information_html ? <div dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(definition.information_html) }} /> : null}</header><div className={styles.canvasFields}>{definition.fields.map((field, index) => <article key={field.stable_field_key} data-selected={field.stable_field_key === selectedKey} onClick={() => setSelectedKey(field.stable_field_key)}><GripVertical aria-hidden="true" /><div><strong>{field.label}</strong><span>{fieldTypeLabels[field.field_type]}{field.required ? " · Required" : ""}</span></div><div className={styles.fieldActions}><button type="button" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveField(field.stable_field_key, -1); }}><MoveUp aria-hidden="true" /></button><button type="button" aria-label={`Move ${field.label} down`} disabled={index === definition.fields.length - 1} onClick={(event) => { event.stopPropagation(); moveField(field.stable_field_key, 1); }}><MoveDown aria-hidden="true" /></button><button type="button" aria-label={`Duplicate ${field.label}`} onClick={(event) => { event.stopPropagation(); const copy = { ...field, stable_field_key: crypto.randomUUID(), internal_label: `${field.internal_label ?? "field"}_copy`, options: field.options.map((option) => ({ ...option, stable_option_key: crypto.randomUUID() })) }; setDefinition((current) => normalize({ ...current, fields: [...current.fields.slice(0, index + 1), copy, ...current.fields.slice(index + 1)] })); setSelectedKey(copy.stable_field_key); }}><Copy aria-hidden="true" /></button><button type="button" aria-label={`Delete ${field.label}`} disabled={definition.fields.length === 1} onClick={(event) => { event.stopPropagation(); setDefinition((current) => normalize({ ...current, fields: current.fields.filter((item) => item.stable_field_key !== field.stable_field_key), rules: current.rules.filter((rule) => !rule.target_field_keys.includes(field.stable_field_key) && !rule.conditions.some((condition) => condition.field_key === field.stable_field_key)) })); setSelectedKey(definition.fields.find((item) => item.stable_field_key !== field.stable_field_key)?.stable_field_key ?? null); }}><Trash2 aria-hidden="true" /></button></div></article>)}</div><button type="button" className={styles.addCanvasField} onClick={() => setMobilePanel("palette")}><Plus aria-hidden="true" />Add field here</button></div></main>{settingsPanel}</div>
    <footer className={styles.builderFooter}><span>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}{message}</span><span>Draft Version {detail.versions.find((version) => version.id === detail.form.current_draft_version_id)?.version_number}</span></footer>
    <VersionHistory versions={detail.versions} formId={detail.form.id} />
    {capabilities.submissionsView || capabilities.assign ? <nav className={styles.relatedLinks}>{capabilities.submissionsView ? <Link href={`/forms/${detail.form.id}/submissions`}>View submissions</Link> : null}{capabilities.assign && ["intake", "onboarding"].includes(detail.form.form_type) ? <Link href={`/forms/${detail.form.id}/assign`}>Assign Form</Link> : null}</nav> : null}
    {capabilities.manage ? <section className={styles.archiveZone} id="archive"><div><h2>Archive Form</h2><p>Published versions and submission history remain available.</p></div><button type="button" onClick={() => setArchiveOpen(true)}>Archive</button></section> : null}
    {previewOpen ? <div className={styles.modalBackdrop} role="presentation"><section className={styles.previewModal} role="dialog" aria-modal="true" aria-labelledby="preview-title"><header><div><span>Draft Preview</span><h2 id="preview-title">{definition.name}</h2></div><button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><X aria-hidden="true" /></button></header><div><FormRenderer schema={schema} mode="preview" /></div></section></div> : null}
    {publishOpen ? <div className={styles.modalBackdrop}><section className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="publish-title"><h2 id="publish-title">Publish this version?</h2><p>Published versions are immutable. Future edits continue in a new draft and never rewrite this version.</p>{error ? <p className={styles.actionError}>{error}</p> : null}<footer><button className="button-secondary" type="button" disabled={pending} onClick={() => setPublishOpen(false)}>Keep editing</button><button className="button-primary" type="button" aria-busy={pending || undefined} disabled={pending} onClick={publish}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Publish</button></footer></section></div> : null}
    {archiveOpen ? <div className={styles.modalBackdrop}><section className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="archive-title"><h2 id="archive-title">Archive this Form?</h2><p>The Form stops accepting submissions. Its versions, assignments, and submissions are retained.</p>{error ? <p className={styles.actionError} role="alert">{error}</p> : null}<footer><button className="button-secondary" type="button" disabled={pending} onClick={() => setArchiveOpen(false)}>Cancel</button><button className={styles.dangerButton} type="button" aria-busy={pending || undefined} disabled={pending} onClick={archive}><LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />Archive Form</button></footer></section></div> : null}
  </div>;
}
