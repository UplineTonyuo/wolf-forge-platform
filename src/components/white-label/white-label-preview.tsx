"use client";

import { ArrowDown, ArrowUp, Bell, FileText, Menu, Plus, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { previewForeground } from "../../domain/white-label/colors";
import { WHITE_LABEL_MODULES, previewNavigationModules, type WhiteLabelPreviewState } from "../../domain/white-label/preview";
import { navigationIcons } from "../shell/internal-shell";
import { navigationCategories } from "../shell/nav-registry";
import styles from "./white-label-builder.module.css";

export type PhonePreset = { id: string; label: string; width: number; height: number };
/** Representative CSS-pixel viewports; the simulated phone renders at exactly these sizes. */
export const DEFAULT_PHONE: PhonePreset = { id: "iphone-15-pro", label: "iPhone 15 Pro", width: 393, height: 852 };
export const PHONE_PRESETS: PhonePreset[] = [
  DEFAULT_PHONE,
  { id: "galaxy-s24", label: "Samsung Galaxy S24", width: 360, height: 780 },
  { id: "pixel-9", label: "Google Pixel 9", width: 412, height: 915 },
];
const BEZEL = 10;

/** Toggles a draft module; returns why the change was refused, or null when applied. */
export type ModuleToggle = (id: string, enable: boolean) => string | null;

const CONFIGURABLE = new Set<string>(WHITE_LABEL_MODULES.map((entry) => entry.id));
const SAMPLE_NOTE = "Sample data only, no live Tenant records.";

// Illustrative figures only: every value is labelled as sample data in the preview.
const SAMPLE_METRICS = [
  { module: "invoices", label: "Total revenue", value: "$24,680", change: "12%", up: true },
  { module: "projects", label: "Active projects", value: "18", change: "3", up: true },
  { module: "tickets", label: "Open tickets", value: "7", change: "2", up: false },
  { module: "clients", label: "Active clients", value: "24", change: "4", up: true },
  { module: "services", label: "Services offered", value: "9", change: "1", up: true },
  { module: "forms", label: "Form submissions", value: "36", change: "5", up: true },
  { module: "reporting", label: "Reports sent", value: "11", change: "2", up: true },
];
const SAMPLE_ACTIVITY = [
  { module: "projects", title: "New project created", time: "2 hours ago" },
  { module: "invoices", title: "Payment received", time: "5 hours ago" },
  { module: "clients", title: "New client added", time: "8 hours ago" },
  { module: "tickets", title: "Ticket updated", time: "1 day ago" },
  { module: "forms", title: "Form submitted", time: "1 day ago" },
  { module: "reporting", title: "Report sent", time: "2 days ago" },
];
const SAMPLE_TREND = [12, 18, 15, 28, 36, 52];
const TREND_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const SAMPLE_RECORDS: Record<string, [string, string][]> = {
  projects: [["Website Redesign", "In progress"], ["Local SEO Campaign", "Planning"], ["Brand Refresh", "In review"]],
  tickets: [["Login help", "Open"], ["Invoice question", "Waiting on client"], ["Feature request", "Closed"]],
  reporting: [["Monthly performance", "Sent"], ["Quarterly review", "Draft"]],
  clients: [["Harbor Dental", "Active"], ["Northside Fitness", "Active"]],
  invoices: [["Invoice 1042", "Paid"], ["Invoice 1043", "Due in 7 days"]],
  subscriptions: [["Growth plan", "Renews monthly"], ["Starter plan", "Renews yearly"]],
  coupons: [["SPRING10", "Active"], ["WELCOME", "Scheduled"]],
  investment_intent: [["Expansion interest", "Follow up"], ["Upgrade interest", "New"]],
  services: [["SEO Management", "Monthly"], ["Website Care", "Monthly"]],
  forms: [["Client intake", "Published"], ["Onboarding checklist", "Draft"]],
  team: [["Account managers", "3 members"], ["Support", "2 members"]],
  team_supervision: [["Client conversations", "12 threads"], ["Internal handoffs", "4 threads"]],
  settings: [["Workspace profile", "Complete"], ["Notifications", "Review"]],
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "WL";
}

function Brand({ name }: { name: string }) {
  return <div className={styles.brand}>
    <span className={styles.monogram} aria-hidden="true">{initials(name)}</span>
    <div><strong data-testid="preview-brand-name">{name || "Untitled workspace"}</strong><span>Simulated</span></div>
  </div>;
}

/** Scales an exact-size simulated viewport down to its slot without changing its CSS pixels. */
function useFitScale(width: number, height: number, maxHeight?: number) {
  const slot = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setScale(Math.min(1, element.clientWidth / width, maxHeight ? maxHeight / height : 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height, maxHeight]);
  return { slot, scale };
}

function TrendChart({ revenue }: { revenue: boolean }) {
  const gradient = useId();
  const max = 60;
  const x = (index: number) => 40 + index * 53;
  const points = SAMPLE_TREND.map((value, index) => [x(index), 110 - (value / max) * 100] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y.toFixed(1)}`).join(" ");
  return <svg className={styles.trendChart} viewBox="0 0 320 134" role="img"
    aria-label={`Illustrative ${revenue ? "revenue" : "activity"} trend from January to June, rising overall. Sample data, no live records.`}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--preview-accent)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--preview-accent)" stopOpacity="0" /></linearGradient></defs>
    {[0, 20, 40, 60].map((tick) => { const y = 110 - (tick / max) * 100; return <g key={tick}><line x1="40" x2="306" y1={y} y2={y} className={styles.chartGrid} /><text x="32" y={y + 3} textAnchor="end" className={styles.chartAxis}>{revenue ? `$${tick}k` : tick}</text></g>; })}
    <path d={`${line} L${x(5)} 110 L${x(0)} 110 Z`} fill={`url(#${gradient})`} />
    <path d={line} className={styles.chartLine} />
    {TREND_MONTHS.map((month, index) => <text key={month} x={x(index)} y="130" textAnchor="middle" className={styles.chartAxis}>{month}</text>)}
  </svg>;
}

export function WhiteLabelPreview({ state, device, phone = DEFAULT_PHONE, onToggleModule, readOnly = false, maxPhoneHeight }: {
  state: WhiteLabelPreviewState;
  device: "desktop" | "mobile";
  phone?: PhonePreset;
  onToggleModule?: ModuleToggle;
  readOnly?: boolean;
  maxPhoneHeight?: number;
}) {
  const [view, setView] = useState({ module: "dashboard", detail: null as string | null });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Transient UI state shared by both devices; never part of the draft.
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; blocked: boolean } | null>(null);
  const mobileMenuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusView = useRef(false);
  const available = previewNavigationModules(state.modules);
  const active = available[view.module] ? view.module : "dashboard";
  const entries = navigationCategories.flatMap((category) => category.items);
  const title = entries.find((entry) => entry.id === active)?.label ?? "Dashboard";
  const selectedModule = WHITE_LABEL_MODULES.find((entry) => entry.id === active);
  const detail = active === view.module ? view.detail : null;
  const { slot, scale } = useFitScale(phone.width + BEZEL * 2, phone.height + BEZEL * 2, maxPhoneHeight);
  function open(id: string) { if (available[id]) { setMobileMenuOpen(false); focusView.current = true; setView({ module: id, detail: null }); } }
  useEffect(() => { if (focusView.current) { heading.current?.focus(); focusView.current = false; } }, [view, mobileMenuOpen]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 6000); return () => window.clearTimeout(timer); }, [notice]);
  function toggle(id: string, enable: boolean) {
    const blocker = onToggleModule?.(id, enable) ?? null;
    const name = WHITE_LABEL_MODULES.find((entry) => entry.id === id)?.label ?? id;
    if (!blocker && !enable && view.module === id) setView({ module: "dashboard", detail: null });
    setNotice({ blocked: blocker !== null, text: blocker ?? `${name} ${enable ? "added to" : "removed from"} the draft. Save Draft to keep this change.` });
  }
  const editToggle = onToggleModule ? <button ref={editButton} type="button" className={styles.editModules} aria-pressed={editing} disabled={readOnly}
    onClick={() => setEditing((current) => !current)}><SlidersHorizontal aria-hidden="true" />{editing ? "Done" : "Edit modules"}</button> : null;
  const theme = {
    "--preview-primary": state.primaryColor,
    "--preview-accent": state.accentColor,
    "--preview-on-primary": previewForeground(state.primaryColor),
    "--preview-on-accent": previewForeground(state.accentColor),
  } as CSSProperties;
  const showControls = Boolean(onToggleModule) && editing && (device === "desktop" || mobileMenuOpen);

  // Normal mode lists only what the draft's workspace would show; edit mode adds
  // the excluded configurable modules back, faded, in their established order.
  const navigation = (
    <div className="sidebar-navigation" role="group" aria-label="Preview navigation">
      {navigationCategories.map((category) => {
        const items = category.items.filter((entry) => entry.id !== "todo" && entry.id !== "white_label"
          && (available[entry.id] === true || (showControls && CONFIGURABLE.has(entry.id))));
        if (!items.length) return null;
        return <section key={category.id} className={`sidebar-section ${styles.navGroup}`} aria-label={category.label}>
          <ul className={styles.linkList}>
            {items.map((entry) => {
              const Icon = navigationIcons[entry.id] ?? FileText;
              const visible = available[entry.id] === true;
              const configurable = CONFIGURABLE.has(entry.id);
              const selected = state.modules[entry.id] === true;
              return <li key={entry.id} className={styles.navRow} data-module={entry.id} data-enabled={visible} data-shown={visible}>
                <button type="button" className={`sidebar-link ${active === entry.id ? "is-active" : ""}`} disabled={!visible}
                  aria-label={`Open ${entry.label} preview`} aria-current={active === entry.id ? "page" : undefined} onClick={() => open(entry.id)}>
                  <Icon aria-hidden={true} /><span>{entry.label}</span>
                </button>
                {configurable && showControls ? <button type="button" role="switch" aria-checked={selected} className={styles.moduleToggle}
                  aria-label={`${entry.label} module`} title={selected ? `Remove ${entry.label} from draft` : `Add ${entry.label} to draft`}
                  disabled={readOnly} onClick={() => toggle(entry.id, !selected)}>
                  <Plus aria-hidden="true" />
                </button> : null}
              </li>;
            })}
          </ul>
        </section>;
      })}
    </div>
  );

  const metrics = SAMPLE_METRICS.filter((metric) => available[metric.module]).slice(0, 4);
  const activity = SAMPLE_ACTIVITY.filter((item) => available[item.module]).slice(0, 4);
  const records = SAMPLE_RECORDS[active] ?? [["Sample record", "Simulated"]];
  const iconFor = (id: string) => navigationIcons[id] ?? FileText;

  const workspace = (
    <div className={styles.workspace} data-testid="preview-workspace" role="region" aria-label={`Simulated ${title} workspace`} tabIndex={0}>
      <div className={styles.workspaceHeader}>
        <div>
          <h4 ref={heading} tabIndex={-1} data-testid="preview-greeting">{active === "dashboard" ? `Welcome to ${state.displayName || "your workspace"}` : `${title}${detail ? " sample" : ""}`}</h4>
          <p className={styles.workspaceLead}>{active === "dashboard" ? SAMPLE_NOTE : selectedModule?.description ?? `Workspace ${title.toLowerCase()} tools.`}</p>
        </div>
        {active === "dashboard" ? <span className={styles.samplePill}>Sample · This month</span> : <button type="button" className={styles.accentAction} onClick={() => open("dashboard")}>Workspace overview</button>}
      </div>
      <section key={`${active}-${detail}`} className={styles.previewContent} aria-label="Simulated view" aria-live="polite">
        {active === "dashboard" ? <div className={styles.dashboard}>
          <ul className={styles.metrics} aria-label="Sample metrics">{metrics.map((metric) => {
            const Icon = iconFor(metric.module);
            const Trend = metric.up ? ArrowUp : ArrowDown;
            return <li key={metric.module}><button type="button" className={styles.metric} onClick={() => open(metric.module)} aria-label={`Explore ${entries.find((entry) => entry.id === metric.module)?.label} preview: sample ${metric.label.toLowerCase()} ${metric.value}`}>
              <span className={styles.metricIcon}><Icon aria-hidden={true} /></span>
              <span className={styles.metricLabel}>{metric.label}</span>
              <strong>{metric.value}</strong>
              <span className={styles.metricChange} data-up={metric.up}><Trend aria-hidden="true" />{metric.change}<small>vs. previous period</small></span>
            </button></li>;
          })}</ul>
          <div className={styles.dashboardSections}>
            <section className={styles.panel} aria-label="Sample trend">
              <div className={styles.panelHeading}><h5>{available.invoices ? "Revenue trend" : "Activity trend"}</h5><span>Sample</span></div>
              <TrendChart revenue={available.invoices === true} />
            </section>
            <section className={styles.panel} aria-label="Sample recent activity">
              <div className={styles.panelHeading}><h5>Recent activity</h5><span>Sample</span></div>
              <ul className={styles.activityList}>{activity.map((item) => {
                const Icon = iconFor(item.module);
                return <li key={item.title}><button type="button" onClick={() => open(item.module)}><span className={styles.activityIcon}><Icon aria-hidden={true} /></span><span><strong>{item.title}</strong><small>{item.time}</small></span></button></li>;
              })}</ul>
            </section>
          </div>
        </div> : <div className={styles.simulatedView}>
          {detail ? <>
            <h5>{detail}</h5>
            <p>This sample demonstrates the draft&apos;s colors and navigation. No record is loaded or changed.</p>
            <button type="button" className={styles.previewLink} onClick={() => open(active)}>Back to {title.toLowerCase()} preview</button>
          </> : <>
            <div className={styles.fakeSearch} aria-hidden="true"><Search />Search {title.toLowerCase()}</div>
            <ul className={styles.recordList} aria-label={`Sample ${title.toLowerCase()}`}>{records.map(([name, status]) => (
              <li key={name}><button type="button" onClick={() => { focusView.current = true; setView({ module: active, detail: name }); }} aria-label={`Open sample ${name}`}>
                <strong>{name}</strong><span className={styles.statusTag}>{status}</span><small>Sample record · simulated detail</small>
              </button></li>
            ))}</ul>
            <p className={styles.sampleNote}>Simulated content for {state.displayName || "this workspace"}. Your Tenant&apos;s records stay outside the preview.</p>
          </>}
        </div>}
      </section>
    </div>
  );

  const noticeRegion = <p className={styles.previewNotice} role="status" aria-live="polite" data-blocked={notice?.blocked}>{notice?.text ?? ""}</p>;
  const topbar = (accountControls: ReactNode) => <div className={styles.appTopbar} aria-hidden="true">
    <span className={styles.fakeSearch}><Search />Search…</span>{accountControls}
  </div>;
  const account = <><Bell className={styles.topbarIcon} /><span className={styles.avatar}><UserRound /></span></>;
  const navigationTools = editToggle ? <div className={styles.drawerTools}>
    <span>{editing ? "Add or remove modules" : "Navigation"}</span>{editToggle}
  </div> : null;

  if (device === "desktop") {
    return <div className={styles.frame} data-device="desktop" style={theme} data-testid="preview-frame" aria-label="Simulated workspace" role="group">
      <div className={styles.desktop}>
        <aside className={styles.sidebar} data-editing={editing} onKeyDown={(event) => {
          if (event.key === "Escape" && editing) { event.stopPropagation(); setEditing(false); editButton.current?.focus(); }
        }}><Brand name={state.displayName} />{navigationTools}{navigation}</aside>
        <div className={styles.applicationShell}>{topbar(account)}{workspace}</div>
      </div>
      {noticeRegion}
    </div>;
  }

  const zoom = { zoom: scale } as CSSProperties;
  return <div ref={slot} className={styles.phoneSlot}>
    <div className={styles.frame} data-device="mobile" data-phone={phone.id} style={{ ...theme, ...zoom, width: phone.width + BEZEL * 2 }} data-testid="preview-frame" role="group" aria-label={`Simulated workspace, ${phone.label} ${phone.width} by ${phone.height}`}>
      <div className={styles.mobile} style={{ width: phone.width, height: phone.height }} data-testid="phone-viewport" onKeyDown={(event) => {
        if (event.key === "Escape" && mobileMenuOpen) { event.stopPropagation(); setMobileMenuOpen(false); setEditing(false); menuButton.current?.focus(); }
      }}>
        <div className={styles.phoneStatus} aria-hidden="true"><span>9:41</span><i /><span>100%</span></div>
        <div className={styles.mobileBar}>
          <button ref={menuButton} type="button" className={styles.mobileMenuButton} aria-label={mobileMenuOpen ? "Close preview navigation" : "Open preview navigation"} aria-expanded={mobileMenuOpen} aria-controls={mobileMenuId} onClick={() => { setMobileMenuOpen((current) => !current); setEditing(false); }}>{mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
          <Brand name={state.displayName} />
          <span className={styles.mobileAccount} aria-hidden="true">{account}</span>
        </div>
        <div className={styles.phoneContent}>
          <div id={mobileMenuId} className={`${styles.sidebar} ${styles.drawer}`} hidden={!mobileMenuOpen}>
            {mobileMenuOpen ? navigationTools : null}
            {navigation}
          </div>
          {!mobileMenuOpen ? <div className={styles.applicationShell}>{workspace}</div> : null}
        </div>
        {noticeRegion}
        <div className={styles.phoneBottom} aria-hidden="true"><span /></div>
      </div>
    </div>
  </div>;
}
