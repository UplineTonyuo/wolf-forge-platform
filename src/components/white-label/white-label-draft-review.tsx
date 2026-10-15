"use client";

import { useEffect, useRef } from "react";
import { draftModuleKeys, draftProblem, type WhiteLabelDraft } from "../../domain/white-label/draft";
import { staticPublicationBlocker, type WhiteLabelModuleKey } from "../../domain/white-label/publication";
import { WHITE_LABEL_DRAFT_GUIDANCE, WHITE_LABEL_MODULES, contrastWithWhite, moduleAvailable, type WhiteLabelPreviewState } from "../../domain/white-label/preview";
import styles from "./white-label-builder.module.css";
import { colorContrast } from "../../domain/white-label/colors";

export function WhiteLabelDraftReview({ draft, state, hasChanges, busy, onBack, onSave, canSave }: {
  draft: WhiteLabelDraft;
  state: WhiteLabelPreviewState;
  hasChanges: boolean;
  busy: boolean;
  onBack: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const problem = draftProblem(state);
  const publicationBlocker = staticPublicationBlocker(draftModuleKeys(state.modules) as WhiteLabelModuleKey[]);
  const lowContrast = contrastWithWhite(state.primaryColor) < 7;
  const selected = WHITE_LABEL_MODULES.filter((module) => state.modules[module.id] === true).length;
  const fields = [
    ["Workspace name", draft.state.displayName.trim(), state.displayName.trim()],
    ["Primary color", draft.state.primaryColor, state.primaryColor],
    ["Accent color", draft.state.accentColor, state.accentColor],
  ];

  return (
    <section className={styles.review} aria-label="White Label Draft Review">
      <header className={styles.reviewHeader}>
        <h2 ref={heading} tabIndex={-1}>Review draft</h2>
        <p>{draft.revision === 0 ? "Compared with loaded defaults. No draft has been saved yet." : `Compared with loaded draft revision ${draft.revision}.`}</p>
        <p>{hasChanges ? "Highlighted values are unsaved changes." : "No unsaved changes to review."}</p>
      </header>
      <button type="button" className="button-secondary" disabled={busy} onClick={onBack}>Back to editing</button>

      <table className={styles.reviewComparison}>
        <caption>Identity and branding</caption>
        <thead><tr><th scope="col">Setting</th><th scope="col">Loaded</th><th scope="col">Proposed</th></tr></thead>
        <tbody>
          {fields.map(([label, loaded, proposed], index) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{index > 0 ? <span className={styles.reviewSwatch} style={{ backgroundColor: loaded }} aria-hidden="true" /> : null}{loaded || "(empty)"}</td>
              <td className={loaded !== proposed ? styles.reviewChanged : undefined}>
                {index > 0 ? <span className={styles.reviewSwatch} style={{ backgroundColor: proposed }} aria-hidden="true" /> : null}
                {proposed || "(empty)"}{loaded !== proposed ? <small>Changed</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className={styles.reviewModules} aria-label="CRM module selections">
        <h3>CRM modules</h3>
        <p className={styles.hint}>{selected} enabled · {WHITE_LABEL_MODULES.length - selected} disabled in this draft.</p>
        <ul>
          {WHITE_LABEL_MODULES.map((module) => {
            const loaded = draft.state.modules[module.id] === true;
            const proposed = state.modules[module.id] === true;
            const missing = proposed && !moduleAvailable(state.modules, module.id);
            const dependencies = module.requires.map((id) => WHITE_LABEL_MODULES.find((entry) => entry.id === id)?.label).join(", ");
            return (
              <li key={module.id}>
                <div><strong>{module.label}</strong>{dependencies ? <small>Requires {dependencies}.</small> : null}</div>
                <div className={loaded !== proposed ? styles.reviewChanged : undefined}>
                  <span>{loaded !== proposed ? `${loaded ? "Enabled" : "Disabled"} → ` : ""}{proposed ? "Enabled" : "Disabled"}</span>
                  {loaded !== proposed ? <small>Changed</small> : null}
                  {missing ? <small className={styles.reviewDependency}>Dependency missing; hidden in preview.</small> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className={styles.hint}>Core workspace modules stay included. Operations stays Wolf Forge-only.</p>
      </section>

      <section className={styles.reviewChecks} aria-label="Draft checks">
        <h3>Draft checks</h3>
        {problem ? <p className={styles.warning}>{problem}</p> : <p className={styles.hint}>No draft validation issues found.</p>}
        {lowContrast ? <p className={styles.warning}>Sidebar text may be hard to read in white. The preview adapts its text; a darker primary color keeps the familiar brand treatment.</p> : null}
        {colorContrast(state.primaryColor, state.accentColor) < 3 ? <p className={styles.warning}>Primary and accent colors are very similar. Choose more contrast so active navigation is easy to distinguish.</p> : null}
        <p className={styles.hint}>These are draft choices, not published CRM behavior. Reviewing applies nothing and does not verify runtime module access.</p>
        <details className={styles.disclosure}><summary>Publication rules and financial safeguards</summary><ul className={styles.safeguards}>{WHITE_LABEL_DRAFT_GUIDANCE.split(". ").map((rule) => <li key={rule}>{rule.endsWith(".") ? rule : `${rule}.`}</li>)}</ul></details>
        <h3>Publication requirements</h3>
        <p className={problem || publicationBlocker ? styles.warning : styles.hint}>
          {problem ? "Fix the draft validation issues before checking publication eligibility."
            : publicationBlocker === "SERVICES_REQUIRED" ? "Draft valid. Not publishable: Services is required. Enable Services explicitly and save a new draft."
            : publicationBlocker ? "Draft valid. Not publishable: selected modules do not meet publication dependencies."
            : hasChanges || draft.revision === 0 ? "Publication eligibility has not been checked. Save this draft before requesting a publication check."
            : "Publication eligibility has not been checked."}
        </p>
      </section>
      <div className={styles.reviewActions}>
        <button type="button" className="button-primary" disabled={!canSave} onClick={onSave}>Save reviewed draft</button>
      </div>
    </section>
  );
}
