"use client";

import type { WhiteLabelDraftSummary } from "../../domain/white-label/draft";
import { draftModuleKeys } from "../../domain/white-label/draft";
import styles from "./white-label-builder.module.css";

export function WhiteLabelDraftList({ summaries, onContinue }: {
  summaries: WhiteLabelDraftSummary[];
  onContinue: (tenantId: string) => void;
}) {
  return <section aria-label="Tenant drafts" className={styles.draftList}>
    <div className={styles.draftListHeading}><h2>Tenant drafts</h2><p>Continue from a saved configuration, or start with the workspace defaults.</p></div>
    {summaries.length ? <ul className={styles.draftCards}>{summaries.map(({tenant, draft}) => <li key={tenant.id} className={styles.draftCard}>
      <div className={styles.draftCardTitle}><h3>{tenant.displayName}</h3><span>{draft.revision ? `Revision ${draft.revision}` : "Never saved"}</span></div>
      <p className={styles.draftName}>{draft.revision ? draft.state.displayName : "Default configuration"}</p>
      <div className={styles.draftSummary}>
        <span className={styles.templateSwatches} aria-label={`Primary ${draft.state.primaryColor}, accent ${draft.state.accentColor}`}><i style={{backgroundColor: draft.state.primaryColor}} /><i style={{backgroundColor: draft.state.accentColor}} /></span>
        <span>{draftModuleKeys(draft.state.modules).length} of 9 modules{draft.revision ? " saved" : " by default"}</span>
      </div>
      {draft.revision && draft.updatedAt ? <p className={styles.savedTime}>Saved <time dateTime={draft.updatedAt}>{new Intl.DateTimeFormat("en", {dateStyle:"medium",timeStyle:"short"}).format(new Date(draft.updatedAt))}</time></p> : null}
      {tenant.status !== "active" ? <p className={styles.hint}>{tenant.status === "suspended" ? "Suspended" : "Archived"} · read-only</p> : null}
      <button type="button" className="button-secondary" aria-label={`Continue Editing ${tenant.displayName}`} onClick={() => onContinue(tenant.id)}>Continue Editing</button>
    </li>)}</ul> : <div className={styles.emptyState}><strong>No manageable Tenants</strong><p>No Tenant drafts are available to your current Platform Admin session.</p></div>}
  </section>;
}
