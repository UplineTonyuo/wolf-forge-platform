"use client";

import { FileText, Info, Monitor, Smartphone } from "lucide-react";
import { useId, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  WHITE_LABEL_MODULES,
  WHITE_LABEL_DRAFT_GUIDANCE,
  moduleAvailable,
  type WhiteLabelPreviewState,
} from "../../domain/white-label/preview";
import { WhiteLabelColorControls } from "./white-label-color-controls";
import { WhiteLabelPreview } from "./white-label-preview";
import { navigationIcons } from "../shell/internal-shell";
import styles from "./white-label-builder.module.css";

type Device = "desktop" | "mobile";

/** Controlled: the draft editor owns the state; `children` render above the controls. */
export function WhiteLabelBuilder({
  state,
  onStateChange: setState,
  readOnly = false,
  children,
  controls,
  tenantName,
  onColorValidityChange,
}: {
  state: WhiteLabelPreviewState;
  onStateChange: Dispatch<SetStateAction<WhiteLabelPreviewState>>;
  readOnly?: boolean;
  children?: ReactNode;
  controls?: ReactNode;
  tenantName?: string;
  onColorValidityChange?: (valid: boolean) => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const id = useId();

  return (
    <div className={styles.builder}>
      {children}
      <a className={styles.previewJump} href={`#${id}-preview`}>Jump to preview</a>

      <div className={styles.layout}>
        {controls ?? <form className={styles.controls} aria-label="White Label preview settings" onSubmit={(event) => event.preventDefault()}>
          <fieldset className={`${styles.group} ${styles.identityGroup}`} disabled={readOnly}>
            <legend className="sr-only">Workspace identity</legend>
            <label className={styles.field} htmlFor={`${id}-name`}>
              <span>Workspace display name</span>
              <input
                id={`${id}-name`}
                type="text"
                maxLength={60}
                value={state.displayName}
                onChange={(event) => setState((current) => ({ ...current, displayName: event.target.value }))}
              />
            </label>
          </fieldset>

          <WhiteLabelColorControls state={state} onStateChange={setState} readOnly={readOnly} onValidityChange={onColorValidityChange} />

          <fieldset className={styles.group} disabled={readOnly}>
            <legend>Modules · {WHITE_LABEL_MODULES.filter((module) => state.modules[module.id]).length} of 9 selected</legend>
            <div className={styles.moduleList}>
              {WHITE_LABEL_MODULES.map((module) => {
                const checked = state.modules[module.id] === true;
                const blocked = checked && !moduleAvailable(state.modules, module.id);
                const requires = module.requires
                  .map((required) => WHITE_LABEL_MODULES.find((entry) => entry.id === required)?.label)
                  .join(", ");
                const Icon = navigationIcons[module.id] ?? FileText;
                return (
                  <div key={module.id} className={styles.moduleTile} data-enabled={checked}>
                  <label className={styles.moduleRow} htmlFor={`${id}-module-${module.id}`}>
                    <Icon aria-hidden={true} />
                    <span className={styles.moduleText}>
                      <strong id={`${id}-module-${module.id}-label`}>{module.label}</strong>
                      <small id={`${id}-module-${module.id}-dependency`}>{requires ? blocked ? `Hidden until ${requires} is on.` : `Needs ${requires}` : module.recommendation === "recommended" ? "Recommended" : module.recommendation === "not_recommended" ? "Not recommended" : "Recurring only"}</small>
                    </span>
                    <input
                      id={`${id}-module-${module.id}`}
                      type="checkbox"
                      checked={checked}
                      aria-labelledby={`${id}-module-${module.id}-label`}
                      aria-describedby={`${id}-module-${module.id}-recommendation ${id}-module-${module.id}-help${requires ? ` ${id}-module-${module.id}-dependency` : ""}`}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          modules: { ...current.modules, [module.id]: event.target.checked },
                        }))
                      }
                    />
                  </label>
                  <details className={styles.moduleDetails} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={`${module.label} details`}><Info aria-hidden="true" /></summary><div id={`${id}-module-${module.id}-help`}><p>{module.description}</p><p id={`${id}-module-${module.id}-recommendation`}>{module.recommendationLabel}</p></div></details>
                  </div>
                );
              })}
            </div>
            <details className={styles.disclosure}>
              <summary>Publication rules and financial safeguards</summary>
              <p>Dashboard, Clients, Team, All Conversations and Settings are always part of a workspace. Operations stays Wolf Forge-only.</p>
              <ul className={styles.safeguards}>{WHITE_LABEL_DRAFT_GUIDANCE.split(". ").map((rule) => <li key={rule}>{rule.endsWith(".") ? rule : `${rule}.`}</li>)}</ul>
            </details>
          </fieldset>
        </form>}

        <section className={styles.previewPanel} aria-labelledby={`${id}-preview`}>
          <div className={styles.previewHeader}>
            <div><h3 id={`${id}-preview`} tabIndex={-1}>Live preview</h3><p className={styles.hint}>{tenantName ? `${tenantName} · ` : ""}Draft appearance and navigation</p></div>
            <div className={styles.deviceSwitch} role="group" aria-label="Preview device">
              {(
                [
                  ["desktop", "Desktop", Monitor],
                  ["mobile", "Mobile", Smartphone],
                ] as const
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" aria-pressed={device === value} onClick={() => setDevice(value)}>
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.stage}>
            <WhiteLabelPreview state={state} device={device} />
          </div>
        </section>
      </div>
    </div>
  );
}
