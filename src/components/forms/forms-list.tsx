"use client";

import { Archive, Eye, FileClock, ListChecks, Pencil, Plus, Search, Send } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { FormCapabilities } from "../../domain/forms/schema";
import type { FormRow } from "../../lib/supabase/database-rows";
import { formStatusLabels, formTypeLabels, titleCaseState } from "../../lib/forms/presentation";
import { formatDate } from "../../lib/format";
import styles from "./forms.module.css";

const tabs = ["order", "contact", "intake", "onboarding"] as const;

export function FormsList({ forms, capabilities }: { forms: FormRow[]; capabilities: FormCapabilities }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("order");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const counts = useMemo(() => Object.fromEntries(tabs.map((type) => [type, forms.filter((form) => form.form_type === type).length])), [forms]);
  const visible = useMemo(() => forms.filter((form) => form.form_type === tab && (!deferredQuery || `${form.name} ${form.canonical_key} ${form.status}`.toLowerCase().includes(deferredQuery))), [deferredQuery, forms, tab]);

  return <div className={styles.listRoot}>
    <div className={styles.listControls}>
      <nav className={styles.typeTabs} aria-label="Form type">{tabs.map((type) => <button key={type} type="button" aria-current={tab === type ? "page" : undefined} onClick={() => setTab(type)}><span>{formTypeLabels[type]}</span><b>{counts[type]}</b></button>)}</nav>
      <div className={styles.listTools}>
        <label className={styles.search}><Search aria-hidden="true" /><span className="sr-only">Search Forms</span><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search Forms" /></label>
        {capabilities.manage ? <Link className="button-primary" href="/forms/new"><Plus aria-hidden="true" />Form</Link> : null}
      </div>
    </div>
    <p className={styles.resultCount} aria-live="polite">{visible.length} {visible.length === 1 ? "Form" : "Forms"}</p>
    {visible.length === 0 ? <section className={styles.empty}><h2>{deferredQuery ? "No Forms match your search." : `No ${formTypeLabels[tab]} yet.`}</h2><p>{deferredQuery ? "Try a different name or clear the search." : "Create the first Form when you are ready."}</p></section> : <>
      <div className={styles.tableWrap}><table className={styles.formsTable}><caption className="sr-only">{formTypeLabels[tab]}</caption><thead><tr><th>Name</th><th>Type</th><th>Visibility</th><th>Status</th><th>Published version</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((form) => <tr key={form.id}><td><Link href={`/forms/${form.id}`} className={styles.rowLink}><strong>{form.name}</strong><small>/f/{form.canonical_key}</small></Link></td><td>{titleCaseState(form.form_type)}</td><td>{titleCaseState(form.visibility)}</td><td><span className={styles.status} data-state={form.status}>{formStatusLabels[form.status]}</span></td><td>{form.published_version_id ? "Published" : "—"}</td><td>{formatDate(form.updated_at)}</td><td><div className={styles.rowActions}><Link href={`/forms/${form.id}`} title="Edit Form"><Pencil aria-hidden="true" /></Link>{form.published_version_id ? <Link href={`/f/${form.canonical_key}`} title="Preview published Form"><Eye aria-hidden="true" /></Link> : null}{capabilities.assign && ["intake", "onboarding"].includes(form.form_type) ? <Link href={`/forms/${form.id}/assign`} title="Assign Form"><Send aria-hidden="true" /></Link> : null}{capabilities.submissionsView ? <Link href={`/forms/${form.id}/submissions`} title="View submissions"><ListChecks aria-hidden="true" /></Link> : null}<Link href={`/forms/${form.id}#versions`} title="Version history"><FileClock aria-hidden="true" /></Link>{capabilities.manage ? <Link href={`/forms/${form.id}#archive`} title="Archive Form"><Archive aria-hidden="true" /></Link> : null}</div></td></tr>)}</tbody></table></div>
      <div className={styles.mobileList}>{visible.map((form) => <Link href={`/forms/${form.id}`} key={form.id}><header><strong>{form.name}</strong><span className={styles.status} data-state={form.status}>{formStatusLabels[form.status]}</span></header><p>{titleCaseState(form.form_type)} · {titleCaseState(form.visibility)}</p><small>Updated {formatDate(form.updated_at)}</small></Link>)}</div>
    </>}
  </div>;
}
