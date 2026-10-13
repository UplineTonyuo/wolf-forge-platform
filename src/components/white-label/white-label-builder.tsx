"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useId, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { WHITE_LABEL_DRAFT_GUIDANCE, moduleToggleBlocker, type WhiteLabelPreviewState } from "../../domain/white-label/preview";
import { AnimatedSelect } from "../ui/animated-select";
import { WhiteLabelColorControls } from "./white-label-color-controls";
import { DEFAULT_PHONE, PHONE_PRESETS, WhiteLabelPreview, type ModuleToggle } from "./white-label-preview";
import styles from "./white-label-builder.module.css";

type Device = "desktop" | "mobile";

const PHONE_OPTIONS = PHONE_PRESETS.map((preset) => ({
  value: preset.id,
  label: `${preset.label} · ${preset.width} × ${preset.height}`,
  leading: <Smartphone className={styles.presetIcon} aria-hidden="true" />,
}));

/** Controlled: the draft editor owns the state; `actions` render under the color controls. */
export function WhiteLabelBuilder({
  state,
  onStateChange: setState,
  readOnly = false,
  children,
  controls,
  actions,
  tenantName,
  onColorValidityChange,
}: {
  state: WhiteLabelPreviewState;
  onStateChange: Dispatch<SetStateAction<WhiteLabelPreviewState>>;
  readOnly?: boolean;
  children?: ReactNode;
  controls?: ReactNode;
  actions?: ReactNode;
  tenantName?: string;
  onColorValidityChange?: (valid: boolean) => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const id = useId();
  // The X/+ controls edit the same controlled draft state as every other field.
  const toggleModule: ModuleToggle = (moduleId, enable) => {
    const blocker = moduleToggleBlocker(state.modules, moduleId, enable);
    if (!blocker) setState((current) => ({ ...current, modules: { ...current.modules, [moduleId]: enable } }));
    return blocker;
  };

  return (
    <div className={styles.builder}>
      {children}
      <a className={styles.previewJump} href={`#${id}-preview`}>Jump to preview</a>

      <div className={styles.layout}>
        {controls ? <div className={styles.reviewColumn}>{controls}{actions ? <div className={styles.draftActions}>{actions}</div> : null}</div> : <form className={styles.controls} aria-label="White Label preview settings" onSubmit={(event) => event.preventDefault()}>
          <div className={styles.controlsHeading}><h2>Workspace settings</h2><p>Brand this workspace</p></div>
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

          {actions ? <div className={styles.draftActions}>{actions}</div> : null}

          <details className={styles.disclosure}>
            <summary>Modules and publication rules</summary>
            <p>Choose Edit modules in the Live Preview sidebar, then add or remove modules with the X and + controls. Dashboard, Clients, Team, All Conversations and Settings are always part of a workspace. Operations stays Wolf Forge-only.</p>
            <ul className={styles.safeguards}>{WHITE_LABEL_DRAFT_GUIDANCE.split(". ").map((rule) => <li key={rule}>{rule.endsWith(".") ? rule : `${rule}.`}</li>)}</ul>
          </details>
        </form>}

        <section className={styles.previewPanel} aria-labelledby={`${id}-preview`}>
          <div className={styles.previewHeader}>
            <div><h2 id={`${id}-preview`} tabIndex={-1}>Live preview</h2><p className={styles.hint}>{tenantName ? `${tenantName} · ` : ""}Simulated preview. No live Tenant data is shown.</p></div>
            <div className={styles.previewTools}>
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
              {device === "mobile" ? <div className={styles.phonePicker}>
                <AnimatedSelect name="phone-size" label="Phone size" menuLabel="Phone sizes" value={phone.id} options={PHONE_OPTIONS}
                  onChange={(value) => setPhone(PHONE_PRESETS.find((preset) => preset.id === value) ?? DEFAULT_PHONE)} />
              </div> : null}
            </div>
          </div>

          <div className={styles.stage} data-device={device}>
            <WhiteLabelPreview state={state} device={device} phone={phone} onToggleModule={toggleModule} readOnly={readOnly} maxPhoneHeight={760} />
          </div>
        </section>
      </div>
    </div>
  );
}
