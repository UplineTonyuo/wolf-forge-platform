"use client";

import { FileText, Monitor, Smartphone } from "lucide-react";
import { useId, useState } from "react";
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import {
  WHITE_LABEL_MODULES,
  contrastWithWhite,
  moduleAvailable,
  normalizeHexColor,
  previewNavigationModules,
  type WhiteLabelPreviewState,
} from "../../domain/white-label/preview";
import { navigationIcons } from "../shell/internal-shell";
import { navigationCategories, navigationForModules } from "../shell/nav-registry";
import settings from "../settings/settings-foundation.module.css";
import styles from "./white-label-builder.module.css";

type Device = "desktop" | "mobile";

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("");
  return letters.toUpperCase() || "WL";
}

function PreviewNavigation({ modules }: { modules: Record<string, boolean> }) {
  // The real shell rule decides what is visible; every candidate stays mounted
  // so an entry can collapse smoothly instead of vanishing.
  const visible = new Set(
    navigationForModules(previewNavigationModules(modules)).flatMap((category) => category.items.map((item) => item.id)),
  );

  return (
    // Decorative copy of the rail: a labelled group, not a landmark, and no headings.
    <div className="sidebar-navigation" role="group" aria-label="Preview navigation">
      {navigationCategories.map((category) => {
        const items = category.items.filter((item) => item.id !== "todo");
        const shown = items.some((item) => visible.has(item.id));
        return (
          <section key={category.id} className={`sidebar-section ${styles.collapsible}`} data-shown={shown} aria-hidden={!shown}>
            <div className={styles.collapsibleInner}>
              <h2 role="none">{category.label}</h2>
              <ul className={`sidebar-links ${styles.linkList}`}>
                {items.map((item) => {
                  const Icon = navigationIcons[item.id] ?? FileText;
                  const on = visible.has(item.id);
                  return (
                    <li key={item.id} className={styles.collapsible} data-shown={on} aria-hidden={!on} data-module={item.id}>
                      <div className={styles.collapsibleInner}>
                        <span className={`sidebar-link ${item.id === "dashboard" ? "is-active" : ""}`}>
                          <Icon aria-hidden={true} />
                          <span>{item.label}</span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PreviewWorkspace({ state }: { state: WhiteLabelPreviewState }) {
  const enabled = WHITE_LABEL_MODULES.filter((module) => moduleAvailable(state.modules, module.id)).slice(0, 3);
  return (
    <div className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <div>
          <span className={styles.workspaceEyebrow}>Dashboard</span>
          <strong data-testid="preview-greeting">Welcome to {state.displayName || "your workspace"}</strong>
        </div>
        <span className={styles.accentAction}>New</span>
      </div>
      <div className={styles.cards} aria-hidden="true">
        {enabled.map((module) => (
          <div key={module.id} className={styles.card}>
            <span>{module.label}</span>
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className={styles.brand}>
      <span className={styles.monogram} aria-hidden="true">{initials(name)}</span>
      <div>
        <strong data-testid="preview-brand-name">{name || "Untitled workspace"}</strong>
        <span>Workspace</span>
      </div>
    </div>
  );
}

/** Controlled: the draft editor owns the state; `children` render above the controls. */
export function WhiteLabelBuilder({
  state,
  onStateChange: setState,
  readOnly = false,
  children,
  controls,
}: {
  state: WhiteLabelPreviewState;
  onStateChange: Dispatch<SetStateAction<WhiteLabelPreviewState>>;
  readOnly?: boolean;
  children?: ReactNode;
  controls?: ReactNode;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const id = useId();

  const frameStyle = {
    "--preview-primary": state.primaryColor,
    "--preview-accent": state.accentColor,
    // Text on the accent switches to navy when white would be unreadable.
    "--preview-on-accent": contrastWithWhite(state.accentColor) < 4.5 ? "var(--wf-navy)" : "#fff",
  } as CSSProperties;
  // Sidebar text is translucent white (about 60-80%), so ask for 7:1 against solid white.
  const lowContrast = contrastWithWhite(state.primaryColor) < 7;

  return (
    <div className={styles.builder}>
      {children}

      <div className={styles.layout}>
        {controls ?? <form className={styles.controls} aria-label="White Label preview settings" onSubmit={(event) => event.preventDefault()}>
          <fieldset className={styles.group} disabled={readOnly}>
            <legend>Identity</legend>
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
            <p className={styles.hint}>The preview uses the name&apos;s initials. Logo upload comes in a later phase.</p>
          </fieldset>

          <fieldset className={styles.group} disabled={readOnly}>
            <legend>Appearance</legend>
            <div className={styles.colors}>
              {(
                [
                  ["primaryColor", "Primary color", "Sidebar and brand surfaces"],
                  ["accentColor", "Accent color", "Active item and primary action"],
                ] as const
              ).map(([key, label, help]) => (
                <label key={key} className={styles.colorField} htmlFor={`${id}-${key}`}>
                  <input
                    id={`${id}-${key}`}
                    type="color"
                    value={state[key]}
                    onChange={(event) =>
                      setState((current) => ({ ...current, [key]: normalizeHexColor(event.target.value, current[key]) }))
                    }
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {help} · <code>{state[key]}</code>
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p className={lowContrast ? styles.warning : styles.statusSlot} role="status">
              {lowContrast ? "Sidebar text may be hard to read on this primary color. Choose a darker color." : ""}
            </p>
          </fieldset>

          <fieldset className={styles.group} disabled={readOnly}>
            <legend>Modules</legend>
            <div className={styles.moduleList}>
              {WHITE_LABEL_MODULES.map((module) => {
                const checked = state.modules[module.id] === true;
                const blocked = checked && !moduleAvailable(state.modules, module.id);
                const requires = module.requires
                  .map((required) => WHITE_LABEL_MODULES.find((entry) => entry.id === required)?.label)
                  .join(", ");
                return (
                  <label key={module.id} className={settings.preferenceRow} htmlFor={`${id}-module-${module.id}`}>
                    <span>
                      <strong>{module.label}</strong>
                      <small id={`${id}-module-${module.id}-help`}>
                        {blocked ? `Hidden until ${requires} is on.` : module.description}
                      </small>
                    </span>
                    <input
                      id={`${id}-module-${module.id}`}
                      type="checkbox"
                      checked={checked}
                      aria-describedby={`${id}-module-${module.id}-help`}
                      onChange={(event) =>
                        setState((current) => ({
                          ...current,
                          modules: { ...current.modules, [module.id]: event.target.checked },
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
            <p className={styles.hint}>
              Dashboard, Clients, Team, All Conversations and Settings are always part of a workspace. Operations stays Wolf Forge-only.
            </p>
          </fieldset>
        </form>}

        <section className={styles.previewPanel} aria-labelledby={`${id}-preview`}>
          <div className={styles.previewHeader}>
            <h3 id={`${id}-preview`}>Live preview</h3>
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
            <div className={styles.frame} data-device={device} style={frameStyle} data-testid="preview-frame">
              {device === "desktop" ? (
                <div className={styles.desktop}>
                  <aside className={styles.sidebar}>
                    <Brand name={state.displayName} />
                    <PreviewNavigation modules={state.modules} />
                  </aside>
                  <PreviewWorkspace state={state} />
                </div>
              ) : (
                <div className={styles.mobile}>
                  <div className={styles.mobileBar}>
                    <Brand name={state.displayName} />
                  </div>
                  <div className={styles.sidebar}>
                    <PreviewNavigation modules={state.modules} />
                  </div>
                  <PreviewWorkspace state={state} />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
