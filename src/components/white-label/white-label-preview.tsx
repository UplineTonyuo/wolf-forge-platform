"use client";

import { FileText } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewForeground } from "../../domain/white-label/colors";
import { WHITE_LABEL_MODULES, moduleAvailable, previewNavigationModules, type WhiteLabelPreviewState } from "../../domain/white-label/preview";
import { navigationIcons } from "../shell/internal-shell";
import { navigationCategories } from "../shell/nav-registry";
import styles from "./white-label-builder.module.css";

function Brand({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "WL";
  return <div className={styles.brand}><span className={styles.monogram} aria-hidden="true">{initials}</span><div><strong data-testid="preview-brand-name">{name || "Untitled workspace"}</strong><span>Simulated</span></div></div>;
}

export function WhiteLabelPreview({ state, device }: { state: WhiteLabelPreviewState; device: "desktop" | "mobile" }) {
  const [view, setView] = useState({ module: "dashboard", detail: false });
  const heading = useRef<HTMLHeadingElement>(null);
  const focusView = useRef(false);
  const available = previewNavigationModules(state.modules);
  const active = available[view.module] ? view.module : "dashboard";
  const entries = navigationCategories.flatMap((category) => category.items);
  const title = entries.find((entry) => entry.id === active)?.label ?? "Dashboard";
  const selectedModule = WHITE_LABEL_MODULES.find((entry) => entry.id === active);
  const detail = active === view.module && view.detail;
  function open(id: string) { if (available[id]) { focusView.current = true; setView({ module: id, detail: false }); } }
  useEffect(() => { if (focusView.current) { heading.current?.focus(); focusView.current = false; } }, [active, detail]);
  const theme = {
    "--preview-primary": state.primaryColor,
    "--preview-accent": state.accentColor,
    "--preview-on-primary": previewForeground(state.primaryColor),
    "--preview-on-accent": previewForeground(state.accentColor),
  } as CSSProperties;
  const navigation = (
    <div className="sidebar-navigation" role="group" aria-label="Preview navigation">
      {navigationCategories.map((category) => {
        const items = category.items.filter((entry) => entry.id !== "todo" && entry.id !== "white_label");
        const shown = items.some((entry) => available[entry.id]);
        return <section key={category.id} className={`sidebar-section ${styles.collapsible}`} data-shown={shown} aria-hidden={!shown}>
          <div className={styles.collapsibleInner}><div className={styles.previewCategory}>{category.label}</div><ul className={styles.linkList}>
            {items.map((entry) => {
              const Icon = navigationIcons[entry.id] ?? FileText;
              const visible = available[entry.id] === true;
              return <li key={entry.id} className={styles.collapsible} data-shown={visible} aria-hidden={!visible} data-module={entry.id}>
                <div className={styles.collapsibleInner}><button type="button" className={`sidebar-link ${active === entry.id ? "is-active" : ""}`} disabled={!visible}
                  aria-label={`Open ${entry.label} preview`} aria-current={active === entry.id ? "page" : undefined} onClick={() => open(entry.id)}>
                  <Icon aria-hidden={true} /><span>{entry.label}</span>
                </button></div>
              </li>;
            })}
          </ul></div>
        </section>;
      })}
    </div>
  );
  const workspace = (
    <div className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <div><h4 ref={heading} tabIndex={-1} data-testid="preview-greeting">{active === "dashboard" ? `Welcome to ${state.displayName || "your workspace"}` : `${title}${detail ? " sample" : ""}`}</h4><p className={styles.hint}>Preview only · no live Tenant data</p></div>
        {active !== "dashboard" ? <button type="button" className={styles.accentAction} onClick={() => open("dashboard")}>Workspace overview</button> : null}
      </div>
      <section key={`${active}-${detail}`} className={styles.previewContent} aria-label="Simulated view" aria-live="polite">
        {active === "dashboard" ? <div className={styles.cards}>{WHITE_LABEL_MODULES.filter((entry) => moduleAvailable(state.modules, entry.id)).map((entry) => (
          <button type="button" key={entry.id} className={styles.card} onClick={() => open(entry.id)} aria-label={`Explore ${entry.label} preview`}><span>{entry.label}</span><span className={styles.cardDescription}>{({subscriptions:"Recurring plans and memberships.",coupons:"Promotional discount campaigns.",investment_intent:"Customer buying-interest signals."} as Record<string,string>)[entry.id] ?? entry.description}</span></button>
        ))}</div> : <div className={styles.simulatedView}>
          <h4>{detail ? `Sample ${title.toLowerCase()} item` : title}</h4>
          <p>{selectedModule?.description ?? `Workspace ${title.toLowerCase()} tools.`}</p>
          {detail ? <><p>This sample demonstrates the draft&apos;s colors and navigation. No record is loaded or changed.</p><button type="button" className={styles.previewLink} onClick={() => open(active)}>Back to {title.toLowerCase()} preview</button></> : <>
            <p>Simulated content for {state.displayName || "this workspace"}. Your Tenant&apos;s records are kept outside the preview.</p>
            <button type="button" className={styles.sampleItem} onClick={() => { focusView.current = true; setView({ module: active, detail: true }); }}><strong>Sample item</strong><span>Open a simulated detail view</span></button>
          </>}
        </div>}
      </section>
    </div>
  );
  return <div className={styles.frame} data-device={device} style={theme} data-testid="preview-frame">
    {device === "desktop" ? <div className={styles.desktop}><aside className={styles.sidebar}><Brand name={state.displayName} />{navigation}</aside>{workspace}</div> : <div className={styles.mobile}><div className={styles.mobileBar}><Brand name={state.displayName} /></div><div className={styles.sidebar}>{navigation}</div>{workspace}</div>}
  </div>;
}
