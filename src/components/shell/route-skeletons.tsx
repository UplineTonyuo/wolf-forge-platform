import type { CSSProperties, ReactNode } from "react";
import { TasksLoading } from "../operations/tasks-loading";
import supervisionRows from "../team-supervision/supervised-conversation-list.module.css";
import supervision from "../team-supervision/supervised-transcript.module.css";
import tickets from "../tickets/tickets.module.css";
import project from "../projects/project-detail.module.css";
import goals from "../goals/goals.module.css";
import invoice from "../invoices/invoice-admin.module.css";
import coupon from "../coupons/coupon-admin.module.css";
import subscription from "../subscriptions/subscriptions.module.css";
import report from "../reporting/reporting.module.css";
import settings from "../settings/settings-foundation.module.css";
import list from "../ui/admin-list.module.css";
import { SettingsSkeletonBody, SETTINGS_SECTION_LABELS, type SettingsSection } from "../settings/settings-skeleton";
export type { SettingsSection } from "../settings/settings-skeleton";

/*
 * Destination-shaped loading skeletons for the internal shell. A sidebar click
 * (InternalShell) and the (internal)/loading.tsx boundary both render
 * <RouteSkeleton pathname=...>. Each variant is a short composition of the
 * primitives below, measured against the real page (header, toolbar, table
 * columns, panels); unknown paths fall back to the generic page skeleton.
 * Shapes only: no fake data, one status per skeleton, everything decorative
 * aria-hidden. Tickets and All Conversations reuse their real CSS-module
 * classes (D-181).
 */

export type InternalSkeletonVariant =
  | "dashboard"
  | "projects"
  | "projectDetail"
  | "ticketDetail"
  | "reportDetail"
  | "invoiceDetail"
  | "invoiceEditor"
  | "subscriptionDetail"
  | "couponEditor"
  | "serviceEditor"
  | "tickets"
  | "reporting"
  | "clients"
  | "clientDetail"
  | "operations"
  | "invoices"
  | "subscriptions"
  | "coupons"
  | "investmentIntent"
  | "services"
  | "forms"
  | "team"
  | "goals"
  | "goalDetail"
  | "conversations"
  | "settings"
  | "section"
  | "generic";

const EXACT: Record<string, InternalSkeletonVariant> = {
  "/dashboard": "dashboard",
  "/orders": "projects",
  "/tickets": "tickets",
  "/reporting": "reporting",
  "/clients": "clients",
  "/companies": "clients",
  "/todo": "operations",
  "/invoices": "invoices",
  "/subscriptions": "subscriptions",
  "/coupons": "coupons",
  "/investment-intent": "investmentIntent",
  "/services": "services",
  "/forms": "forms",
  "/team": "team",
  "/team/goals": "goals",
  "/team/all-conversations": "conversations",
  "/settings": "settings",
};

/**
 * Exact match on the list routes, so a detail page such as /tickets/abc never
 * borrows the list skeleton. Settings sub-pages share the settings shell.
 */
export function getInternalSkeletonVariant(pathname: string): InternalSkeletonVariant {
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  if (EXACT[path]) return EXACT[path];
  if (/^\/tickets\/[^/]+$/.test(path)) return "ticketDetail";
  if (/^\/reporting\/[^/]+$/.test(path) && path !== "/reporting/new") return "reportDetail";
  if (/^\/invoices\/(?:new|[^/]+\/edit)$/.test(path)) return "invoiceEditor";
  if (/^\/invoices\/[^/]+$/.test(path)) return "invoiceDetail";
  if (/^\/subscriptions\/[^/]+$/.test(path) && path !== "/subscriptions/new") return "subscriptionDetail";
  if (/^\/coupons\/[^/]+$/.test(path)) return "couponEditor";
  if (/^\/services\/[^/]+$/.test(path)) return "serviceEditor";
  if (/^\/clients\/[^/]+$/.test(path) && path !== "/clients/new") return "clientDetail";
  if (/^\/orders\/(?!new(?:\/|$))[^/]+(?:\/|$)/.test(path)) return "projectDetail";
  if (path.startsWith("/team/goals/")) return "goalDetail";
  if (path.startsWith("/settings/")) return "settings";
  return "generic";
}

/* ---------- primitives ---------- */

type Size = number | string;

function Bar({ w, h, r, className }: { w?: Size; h?: Size; r?: Size; className?: string }) {
  return (
    <span
      className={className ? `internal-page-skeleton-bar ${className}` : "internal-page-skeleton-bar"}
      style={{ width: w, height: h, borderRadius: r }}
    />
  );
}

/** Button/pill/input shapes, e.g. [[86, 40], [117, 40]]. */
function Shapes({ sizes, r = 6 }: { sizes: [Size, number][]; r?: number }) {
  return sizes.map(([w, h], index) => <Bar key={index} w={w} h={h} r={r} className="route-skeleton-shape" />);
}

/** One status per skeleton; everything inside is decorative. */
function Frame({
  className = "page-frame",
  variant,
  children,
  label,
}: {
  className?: string;
  variant: InternalSkeletonVariant;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className={`${className} internal-page-skeleton`} data-skeleton={variant} role="status" aria-label={label ?? (variant === "section" ? "Loading section" : undefined)}>
      {variant !== "section" ? <span className="sr-only">Loading page</span> : null}
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function Header({ subtitle = true, actions }: { subtitle?: boolean; actions?: [Size, number][] }) {
  return (
    <div className="page-header">
      <div>
        <Bar className="internal-page-skeleton-title" />
        {subtitle ? <Bar className="internal-page-skeleton-subtitle" /> : null}
      </div>
      {actions ? (
        <div className="route-skeleton-row">
          <Shapes sizes={actions} />
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ left = [], right = [], r }: { left?: [Size, number][]; right?: [Size, number][]; r?: number }) {
  return (
    <div className="route-skeleton-toolbar">
      <div className="route-skeleton-row">
        <Shapes sizes={left} r={r} />
      </div>
      <div className="route-skeleton-row">
        <Shapes sizes={right} />
      </div>
    </div>
  );
}

/** Column spec: a number is an `fr` weight, "check" a checkbox column, any other string a fixed track. */
type Column = number | string;

function track(column: Column) {
  if (column === "check") return "18px";
  return typeof column === "number" ? `minmax(0, ${column}fr)` : column;
}

/**
 * Navy-headed table. Below 768px it becomes stacked rows with two bars, the
 * way the real list pages switch to their mobile record lists.
 */
function Table({ columns, rows = 7 }: { columns: Column[]; rows?: number }) {
  const style = { "--route-skeleton-cols": columns.map(track).join(" ") } as CSSProperties;
  const keep = new Set(columns.flatMap((column, index) => (column === "check" ? [] : [index])).slice(0, 2));
  const cell = (column: Column, index: number, header: boolean) => {
    if (column === "check") return <Bar key={index} w={16} h={16} r={4} className="route-skeleton-check" />;
    return (
      <Bar
        key={index}
        w={header ? "45%" : keep.has(index) ? "78%" : "58%"}
        className={!header && keep.has(index) ? "route-skeleton-keep" : undefined}
      />
    );
  };
  return (
    <div className="route-skeleton-table" style={style}>
      <div className="route-skeleton-thead">{columns.map((column, index) => cell(column, index, true))}</div>
      {Array.from({ length: rows }, (_, row) => (
        <div className="route-skeleton-tr" key={row}>
          {columns.map((column, index) => cell(column, index, false))}
        </div>
      ))}
    </div>
  );
}

function Cards({ count, height, className }: { count: number; height: number; className: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, card) => (
        <div className="route-skeleton-panel" style={{ minHeight: height }} key={card}>
          <Bar w="40%" />
          <Bar w="60%" h={22} />
        </div>
      ))}
    </div>
  );
}

function Panel({ height, title = "30%", children }: { height?: number; title?: Size; children?: ReactNode }) {
  return (
    <div className="route-skeleton-panel" style={{ minHeight: height }}>
      <Bar w={title} h={14} />
      {children}
    </div>
  );
}

/** Bordered list of two-line rows with an optional trailing pill. */
function Rows({ count, side = true, height = 64 }: { count: number; side?: boolean; height?: number }) {
  return (
    <div className="route-skeleton-rows">
      {Array.from({ length: count }, (_, row) => (
        <div className="route-skeleton-list-row" style={{ minHeight: height }} key={row}>
          <div>
            <Bar w="55%" />
            <Bar w="35%" h={8} />
          </div>
          {side ? <Bar w={64} h={22} r={999} /> : null}
        </div>
      ))}
    </div>
  );
}

function Split({ columns, children }: { columns: string; children: ReactNode }) {
  return (
    <div
      className="route-skeleton-split"
      style={{ "--route-skeleton-split": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}

function Fields({ count, className = "route-skeleton-fields", fieldClassName }: { count: number; className?: string; fieldClassName?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, field) => (
        <div key={field} className={fieldClassName}>
          <Bar w={110} h={9} />
          <Bar w="100%" h={40} r={6} />
        </div>
      ))}
    </div>
  );
}

function FactRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <div key={i}><dt><Bar w={90} h={9} /></dt><dd><Bar w="65%" h={14} /></dd></div>);
}

/* ---------- destination compositions ---------- */

export type ClientSection = "details" | "projects" | "invoices" | "activities" | "history";

function ClientSectionBody({ section }: { section: ClientSection }) {
  if (section !== "details") return <section className={section === "history" ? "client-tab-panel client-history-panel" : "client-tab-panel"} data-client-section={section}>
    <div className="client-section-heading"><div><Bar w={85} h={9} /><Bar w={150} h={18} className="route-skeleton-gap" /></div>{section === "projects" ? <Bar w={30} h={28} /> : null}</div>
    {section === "projects" ? <div className="client-project-summary">{[0, 1, 2].map(i => <div className="client-project-summary-row" key={i}><Bar w="65%" h={16} /><Bar w={65} h={24} /></div>)}</div>
      : section === "history" ? <div className="client-history-timeline">{[0, 1].map(day => <section className="client-history-day" key={day}><h3><Bar w={110} /></h3><div className="client-history-events">{[0, 1, 2].map(i => <div className="client-history-event" key={i}><span className="client-history-marker"><Bar w={14} h={14} /></span><div className="client-history-copy"><div className="client-history-meta"><Bar w={70} h={9} /><Bar w={50} h={9} /></div><Bar w="75%" h={14} /></div></div>)}</div></section>)}</div>
      : <p className="client-detail-empty"><Bar w="60%" h={15} /></p>}
  </section>;
  return <div className="client-detail-content">
    <section className="client-information-panel">
      <div className="client-section-heading"><Bar w={160} h={20} /></div>
      <dl className="client-information-list">{Array.from({ length: 6 }, (_, i) => <div key={i}><dt><Bar w={100} /></dt><dd><Bar w="70%" /></dd></div>)}</dl>
    </section>
    <section className="client-side-summary">
      <div className="client-section-heading"><Bar w={140} h={20} /></div>
      <Rows count={3} side={false} />
    </section>
  </div>;
}

export function ClientSectionSkeleton({ section }: { section: ClientSection }) {
  return <Frame variant="section" className="route-skeleton-section" label={`Loading client ${section}`}><ClientSectionBody section={section} /></Frame>;
}

export function ClientDetailSkeleton({ section = "details" }: { section?: ClientSection } = {}) {
  return <Frame variant="clientDetail">
    <Header subtitle={false} actions={[[86, 36]]} />
    <div className="client-detail-context"><Bar w={85} h={18} /><Bar w={90} h={32} /></div>
    <div className="client-detail-tabs"><Shapes sizes={[[92, 36], [102, 36], [100, 36], [108, 36], [92, 36]]} /></div>
    <ClientSectionBody section={section} />
  </Frame>;
}

export function SectionSkeleton() {
  return (
    <Frame variant="section" className="route-skeleton-section">
      <div className="route-skeleton-stack">
        <Bar w={160} h={20} />
        <Bar w="60%" h={10} />
        <Fields count={3} />
        <Rows count={3} side={false} />
      </div>
    </Frame>
  );
}

type ProjectSection = "details" | "files" | "history";

function ProjectBody({ section }: { section: ProjectSection }) {
  if (section === "files") return <section data-skeleton-body="files">
    <Bar w={100} h={20} />
    <div className={project.filesTable}>
      <div className={project.filesHeaderRow}><Bar w={110} /><Bar w={80} /></div>
      <ul className={project.filesList}>{Array.from({ length: 3 }, (_, i) => <li key={i}><Bar w={18} h={22} /><span className={project.filesNameGroup}><Bar w="70%" /><Bar w="45%" /></span><span className={project.filesDate}><Bar w={80} /></span></li>)}</ul>
    </div>
  </section>;
  if (section === "history") return <section data-skeleton-body="history">
    <Bar w={100} h={20} />
    <div className={project.historyStream}><div className={project.historyGroup}>
      <Bar w={120} h={14} />
      <ul className={project.historyList}>{Array.from({ length: 3 }, (_, i) => <li key={i}><Bar w={28} h={28} r={999} /><div className={project.historyBody}><Bar w="75%" /><Bar w={100} /></div></li>)}</ul>
    </div></div>
  </section>;
  return <div className="route-skeleton-stack" data-skeleton-body="details">
    <div className="route-skeleton-panel"><Bar w="60%" h={40} /></div>
    <section className={project.fieldsCard} data-skeleton-block="project-responses"><Bar w={160} h={20} /><Rows count={2} side={false} /></section>
    <div className="route-skeleton-panel route-skeleton-stack" data-skeleton-block="project-conversation"><Bar w={140} h={20} /><Rows count={3} side={false} /><Bar h={100} /></div>
    <section className={project.secondary} data-skeleton-block="project-tasks"><div className={project.panel}><div className={project.panelHeading}><Bar w={100} h={18} /></div><div className={project.panelBody}><Rows count={3} side={false} /></div></div></section>
  </div>;
}

export function ProjectDetailsSkeleton() {
  return <Frame variant="section" className="route-skeleton-section" label="Loading project details"><ProjectBody section="details" /></Frame>;
}
export function ProjectFilesSkeleton() {
  return <Frame variant="section" className="route-skeleton-section" label="Loading project files"><ProjectBody section="files" /></Frame>;
}
export function ProjectHistorySkeleton() {
  return <Frame variant="section" className="route-skeleton-section" label="Loading project history"><ProjectBody section="history" /></Frame>;
}

function ProjectDetailSkeleton({ section = "details" }: { section?: ProjectSection } = {}) {
  return <Frame variant="projectDetail" className={`page-frame ${project.orderFrame}`}>
    <Header />
    <div className={project.subnav}>
      <div className={project.subnavLeft}>
        <Bar w={86} h={36} r={6} />
        <div className={project.tabs}><Shapes sizes={[[70, 32], [55, 32], [70, 32]]} /></div>
      </div>
      <div className={project.headerControls}><Shapes sizes={[[100, 36], [130, 36], [98, 36]]} /></div>
    </div>
    <div className={project.layout}><div className={project.main}><ProjectBody section={section} /></div><aside className={project.rail}><div className={project.railCard}><Rows count={6} side={false} /></div></aside></div>
  </Frame>;
}

export function SettingsSectionSkeleton({ section = "general" }: { section?: SettingsSection } = {}) {
  return <Frame variant="section" className="route-skeleton-section" label={`Loading ${SETTINGS_SECTION_LABELS[section]} settings`}>
    <div data-skeleton-body="settings"><SettingsSkeletonBody section={section} /></div>
  </Frame>;
}

// Header bar widths per column (Ticket, Client / company, Status, Priority, Assigned, Last activity). Shapes only, no labels.
const TICKET_COLUMNS = [44, 96, 46, 52, 56, 74];

function TicketsSkeleton() {
  return (
    <Frame variant="tickets">
      <Header />
      <section className={tickets.listSurface}>
        <div className={tickets.listToolbar}>
          <Bar w="min(420px, 100%)" h={40} r={4} className="route-skeleton-ticket-search" />
          <Bar w={86} h={40} r={6} className="route-skeleton-ticket-action route-skeleton-push" />
          <Bar w={117} h={40} r={6} className="route-skeleton-ticket-action" />
        </div>
        <div className={tickets.tableWrap}>
          <table>
            <thead>
              <tr>
                {TICKET_COLUMNS.map((width, column) => (
                  <th key={column}>
                    <Bar w={width} h={8} className="route-skeleton-on-navy" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, row) => (
                <tr key={row}>
                  <td>
                    <Bar w={70} />
                    <Bar w="80%" h={8} className="route-skeleton-gap" />
                  </td>
                  <td>
                    <Bar w="70%" />
                    <Bar w="50%" h={8} className="route-skeleton-gap" />
                  </td>
                  <td>
                    <Bar w={72} h={22} r={999} />
                  </td>
                  <td>
                    <Bar w={56} h={22} r={999} />
                  </td>
                  <td>
                    <Bar w="60%" />
                  </td>
                  <td>
                    <Bar w="50%" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={tickets.mobileList}>
          {Array.from({ length: 6 }, (_, row) => (
            <a key={row}>
              <Bar w={16} h={16} r={4} />
              <div>
                <Bar w="70%" />
                <Bar w="45%" h={8} className="route-skeleton-gap" />
              </div>
            </a>
          ))}
        </div>
      </section>
    </Frame>
  );
}

function DashboardSkeleton() {
  return (
    <Frame className="route-skeleton-dashboard" variant="dashboard">
      <div className="route-skeleton-toolbar route-skeleton-hero">
        <div className="route-skeleton-stack">
          <Bar w={504} h={40} />
          <Bar w={300} h={12} />
        </div>
        <Bar w={113} h={34} r={6} />
      </div>
      <Cards count={4} height={188} className="route-skeleton-metrics" />
      <Panel height={408} title="18%" />
      <Split columns="minmax(0, 1.6fr) minmax(290px, .75fr)">
        <Panel height={250} />
        <Panel height={250} />
      </Split>
    </Frame>
  );
}

function ProjectsSkeleton() {
  return (
    <Frame variant="projects">
      <Header />
      <Toolbar left={[[113, 48], [125, 48], [49, 48]]} right={[[87, 46], [133, 46]]} />
      <Table columns={["check", 3, 1.5, 1.5, 0.9, 1.5]} />
    </Frame>
  );
}

function ReportingSkeleton() {
  return (
    <Frame variant="reporting">
      <div className="page-header"><div><div className={report.loadingHeading}><Bar w={220} h="100%" /></div><div className={report.loadingDescription}><Bar w="min(340px, 100%)" h={12} /><Bar w="70%" h={12} /></div></div><div className="page-actions"><span className={`${report.compactAction} page-action-compact`} style={{ background: "none", border: 0, boxShadow: "none" }}><Bar w={40} h={40} /></span></div></div>
      <div className={list.toolbar}>
        <div className={list.filters}>{[34, 52, 44].map((width, i) => <span className={list.filter} key={i}><Bar w={width} h={12} /></span>)}</div>
        <div className={list.trailing}><div className={list.action}><span className={`${report.primaryButton} ${report.toolbarAction}`} style={{ background: "none", borderColor: "transparent" }}><Bar w={80} h="1lh" /></span></div></div>
      </div>
      <ol className={report.list}>{[0, 1, 2, 3, 4].map(i => <li className={report.row} key={i}>
        <div className={report.rowMain}><Bar w="65%" h={21} /><p className={report.rowMeta}>{[125, 95, 100, 110, 130].map((width, meta) => <span key={meta} style={{ display: "inline-flex", alignItems: "center", minHeight: "1lh" }}><Bar w={width} h={12} /></span>)}</p></div>
        <div className={report.rowSide}><span className={report.status}><Bar w={45} h={10} /></span></div>
      </li>)}</ol>
    </Frame>
  );
}

function ClientsSkeleton() {
  return (
    <Frame variant="clients">
      <Header subtitle={false} />
      <Toolbar left={[[78, 34], [70, 34], [84, 34]]} right={[[126, 40], [87, 40]]} r={999} />
      <Table columns={["check", 2, 1.6, 1, 0.8, "40px"]} />
    </Frame>
  );
}

function OperationsSkeleton() {
  return (
    // TasksLoading's own status sits inside the aria-hidden part; the frame's status is the one announced.
    <Frame variant="operations">
      <Header />
      <div className="operations-tabs">
        <Bar w={59} h={34} r={5} />
        <Bar w={103} h={34} r={5} />
      </div>
      <div className="operations-tab-panel">
        <TasksLoading />
      </div>
    </Frame>
  );
}

function InvoicesSkeleton() {
  return (
    <Frame variant="invoices">
      <Header subtitle={false} />
      <Toolbar right={[[146, 40], [259, 40], [87, 40]]} />
      <Table columns={[2, 1, 1, 1, 1, 1, "72px"]} />
    </Frame>
  );
}

function SubscriptionsSkeleton() {
  return (
    <Frame variant="subscriptions">
      <Header />
      <Toolbar right={[[360, 44], [87, 44], [133, 44]]} />
      <Table columns={[1.6, 1.5, 1.3, 1, 0.9, 1, 1, 0.8, 0.8]} />
    </Frame>
  );
}

function CouponsSkeleton() {
  return (
    <Frame variant="coupons">
      <Header subtitle={false} />
      <Toolbar left={[[67, 34], [83, 34]]} right={[[151, 40], [259, 40]]} r={999} />
      <Table columns={[1.1, 2, 0.9, 0.9, 0.8, 0.8, 0.9, 0.9, "72px"]} />
    </Frame>
  );
}

function InvestmentIntentSkeleton() {
  return (
    <Frame variant="investmentIntent">
      <Header />
      <Cards count={4} height={75} className="route-skeleton-summary" />
      <Toolbar left={[[360, 40]]} right={[[87, 40]]} />
      <Table columns={[1.5, 1.4, 0.8, 0.7, 1, 1, 0.8, "80px"]} />
    </Frame>
  );
}

function ServicesSkeleton() {
  return (
    <Frame variant="services">
      <Header actions={[[134, 40], [109, 40]]} />
      <Split columns="minmax(0, .9fr) minmax(0, 1fr)">
        <div className="route-skeleton-stack">
          <Panel height={260} title="40%" />
          <Panel height={260} title="40%" />
        </div>
        <div className="route-skeleton-stack">
          <div className="route-skeleton-toolbar">
            <Bar w={150} h={24} />
            <Bar w={116} h={34} r={6} />
          </div>
          <Rows count={6} />
        </div>
      </Split>
    </Frame>
  );
}

function FormsSkeleton() {
  return (
    <Frame variant="forms">
      <Header />
      <Toolbar left={[[101, 40], [113, 40], [103, 40], [136, 40]]} right={[[300, 44], [93, 40]]} />
      <Table columns={[2, 1, 1, 0.9, 1.1, 1, "48px"]} />
    </Frame>
  );
}

function GoalsSkeleton() {
  return (
    <Frame className={goals.page} variant="goals">
      <Header actions={[[140, 40], [105, 40]]} />
      <Toolbar left={[[80, 38], [120, 38], [110, 38]]} />
      <div className={goals.cards}>
        {Array.from({ length: 3 }, (_, index) => (
          <div className={goals.card} key={index}>
            <div className={goals.cover}><Bar w="100%" h="100%" r={0} /></div>
            <div className={goals.cardBody}>
              <Bar w="35%" h={10} />
              <Bar w="80%" h={20} className="route-skeleton-gap" />
              <Bar w="65%" h={11} className="route-skeleton-gap" />
              <Bar w="100%" h={6} className="route-skeleton-gap" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function GoalDetailSkeleton() {
  return (
    <Frame className={goals.page} variant="goalDetail">
      <Bar w={100} h={12} className="route-skeleton-gap" />
      <Header actions={[[110, 40], [100, 40]]} />
      <div className={goals.detailGrid}>
        <div className={goals.detailMain}>
          <div className={goals.coverLarge}><Bar w="100%" h="100%" /></div>
          <Bar w={140} h={20} className="route-skeleton-gap" />
          <Rows count={3} height={54} side={false} />
        </div>
        <div className={goals.overview}>
          <Bar w="65%" h={18} />
          <Bar w="100%" h={6} className="route-skeleton-gap" />
          <Fields count={3} />
        </div>
      </div>
    </Frame>
  );
}

function TeamSkeleton() {
  return (
    <Frame className="route-skeleton-team" variant="team">
      <Header />
      <Bar w={180} h={14} className="route-skeleton-gap" />
      <Toolbar left={[[317, 42]]} right={[[115, 40]]} />
      <Split columns="minmax(0, 1fr) 300px">
        <div className="route-skeleton-panel">
          <div className="route-skeleton-toolbar">
            <Bar w={150} h={16} />
            <Bar w={280} h={38} r={6} />
          </div>
          <Rows count={5} height={76} />
        </div>
        <div className="route-skeleton-panel">
          <Bar w="60%" h={16} />
          <Rows count={5} height={84} side={false} />
        </div>
      </Split>
    </Frame>
  );
}

/** Avatar plus two lines, in the real row's box. */
function PersonRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, row) => (
    <div className={supervisionRows.row} key={row}>
      <Bar w={28} h={28} r={999} />
      <span className={supervisionRows.text} style={{ gap: 7 }}>
        <Bar w={row % 3 ? "62%" : "74%"} />
        <Bar w="38%" h={8} />
      </span>
    </div>
  ));
}

/**
 * The real workspace classes, so the panes collapse exactly as the page does:
 * three panes on desktop, two on tablet, employees alone on phones. The
 * transcript pane is blank because the page opens with none selected.
 */
function ConversationsSkeleton() {
  return (
    <Frame className={`page-frame ${supervision.frame}`} variant="conversations">
      <Header />
      <div className={supervision.workspace} data-view="employees">
        <div className={supervision.employeePane}>
          <div className={`${supervision.paneHeader} ${supervision.employeeTitle}`}>
            <Bar w={92} h={14} />
          </div>
          <div className={supervision.filterRow}>
            <Bar w="100%" h={38} r={8} />
          </div>
          <div>
            <PersonRows count={7} />
          </div>
        </div>
        <div className={supervision.conversationPane}>
          <div className={`${supervision.paneHeader} ${supervision.employeeHeader}`}>
            <Bar w={36} h={36} r={999} />
            <span className={supervisionRows.text} style={{ gap: 7 }}>
              <Bar w={140} h={14} />
              <Bar w={64} h={8} />
            </span>
          </div>
          <div>
            <PersonRows count={4} />
          </div>
        </div>
        <div className={supervision.placeholder} />
      </div>
    </Frame>
  );
}

function SettingsSkeleton({ section = "general" }: { section?: SettingsSection } = {}) {
  return (
    <div className="settings-page-layout">
      <Frame variant="settings">
        <Header />
        <div className={settings.shell}>
          <div className={settings.navigation}>
            {Array.from({ length: 6 }, (_, link) => (
              <div className={settings.navigationLink} key={link}><Bar w={16} h={16} /><Bar w="70%" h={12} /></div>
            ))}
          </div>
          <div className={settings.content}><SettingsSkeletonBody section={section} /></div>
        </div>
      </Frame>
    </div>
  );
}

function TicketDetailSkeleton() {
  return <Frame variant="ticketDetail" className={`page-frame ${tickets.ticketDetailPage}`}>
    <Header />
    <div className={tickets.ticketWorkspace}>
      <aside className={tickets.ticketWorkspaceList} data-skeleton-block="ticket-queue">{Array.from({ length: 6 }, (_, i) => <div className={tickets.ticketWorkspaceListItem} key={i}>
        <Bar w={16} h={16} /><span className={tickets.ticketWorkspaceListBody}><Bar w="75%" h={12} /><Bar w="50%" h={10} className="route-skeleton-gap" /><Bar w={70} h={18} className="route-skeleton-gap" /></span>
      </div>)}</aside>
      <div className={tickets.ticketWorkspaceManagement} data-skeleton-block="ticket-management">
        <div className={tickets.inspectorSections}>
          <section><Bar w={110} h={14} /><dl className={tickets.ticketMeta}>{Array.from({ length: 4 }, (_, i) => <div key={i}><dt><Bar w={90} h={9} /></dt><dd><Bar w="45%" h={13} /></dd></div>)}</dl></section>
          <section><Bar w={100} h={14} /><Fields count={3} /></section>
          <section><Bar w={130} h={14} /><Bar w="100%" h={100} className="route-skeleton-gap" /></section>
          <section><Bar w={120} h={40} /></section>
        </div>
      </div>
    </div>
  </Frame>;
}

function ReportDetailSkeleton() {
  return <Frame variant="reportDetail"><Header />
    {/* Mode is unknown before the authorized record arrives. Reserve report content without suggesting editable controls. */}
    <div className={report.builder}>
      <div className={report.identity}><Bar w={180} h={18} /><Bar w={120} h={12} /></div>
      <div className="route-skeleton-stack">
        {Array.from({ length: 3 }, (_, i) => <section className="route-skeleton-panel route-skeleton-stack" key={i}>
          <Bar w="40%" h={20} /><Bar w="85%" /><Bar w="70%" /><Bar w="60%" />
        </section>)}
      </div>
    </div>
  </Frame>;
}

function InvoiceDetailSkeleton() {
  return <Frame variant="invoiceDetail" className={`page-frame ${invoice.detailPage}`}>
    <Header actions={[[120, 40], [40, 40]]} />
    <div className={invoice.metadata}>{Array.from({ length: 6 }, (_, i) => <div key={i}><Bar w="40%" h={9} /><Bar w="65%" h={14} className="route-skeleton-gap" /></div>)}</div>
    <div className={invoice.detailGrid}>
      <section className={invoice.detailSection}><Bar w={110} h={20} /><div className={invoice.lineItems}><Rows count={2} height={66} /></div></section>
      <section className={invoice.detailSection}><Bar w={150} h={20} /><Rows count={6} height={36} /></section>
    </div>
    <Split columns="repeat(2, minmax(0, 1fr))"><Panel height={160} /><Panel height={160} /></Split>
    <Panel height={150} />
  </Frame>;
}

function InvoiceEditorSkeleton({ editing = false }: { editing?: boolean } = {}) {
  return <Frame variant="invoiceEditor"><Header />
    <div className={invoice.form}>
      <section className={invoice.formSection}><div className={invoice.sectionHeading}><Bar w={90} h={20} /><Bar w={200} className="route-skeleton-gap" /></div><Fields count={editing ? 5 : 4} className={invoice.basicFields} fieldClassName={invoice.field} /></section>
      <section className={invoice.formSection}>
        <div className={invoice.sectionHeading}><Bar w={90} h={20} /></div>
        <div className={invoice.itemEditor}>
          <article className={invoice.itemRow}>
            <header><Bar w={70} /><Bar w={126} h={32} r={6} /></header>
            <div className={invoice.itemFields}>
              <div className={invoice.serviceField}><Bar w={90} /><Bar w="100%" h={40} /></div>
              <div className={`${invoice.field} ${invoice.descriptionField}`}><Bar w={90} /><Bar w="100%" h={76} /></div>
              {Array.from({ length: 3 }, (_, i) => <div className={invoice.field} key={i}><Bar w="65%" /><Bar w="100%" h={40} /></div>)}
              {editing ? <div className={invoice.taxable}><Bar w={18} h={18} /><Bar w={65} /></div> : null}
            </div>
          </article>
          <Bar w={105} h={40} r={6} />
          <div className={invoice.preview}>{Array.from({ length: editing ? 4 : 3 }, (_, i) => <div key={i}><Bar w={80} /><Bar w={70} h={14} /></div>)}</div>
        </div>
      </section>
      <div className={invoice.formActions}><Shapes sizes={[[85, 40], [120, 40]]} /></div>
    </div>
  </Frame>;
}

function SubscriptionDetailSkeleton() {
  return <Frame variant="subscriptionDetail" className={`page-frame ${subscription.detailPage}`}>
    <Bar w={150} h={18} /><Header actions={[[70, 28], [40, 40]]} />
    <div className={subscription.detailRoot}><Toolbar left={[[80, 38], [80, 38], [80, 38], [80, 38]]} />
      <section className={subscription.overview}><Bar w={180} h={20} /><dl><FactRows count={8} /></dl></section>
      <section className={subscription.planSection}><header><Bar w={140} h={20} /></header><div className={subscription.planBody}><Bar w="60%" h={24} /><dl className={subscription.planFacts}><FactRows count={4} /></dl><Rows count={2} height={64} /></div></section>
    </div>
  </Frame>;
}

function CouponEditorSkeleton() {
  return <Frame variant="couponEditor"><Header />
    <div className={coupon.form}>
      <section className={coupon.formSection}><div className={coupon.sectionHeading}><Bar w={100} h={20} /></div><Fields count={2} className={coupon.fields} fieldClassName={coupon.field} /></section>
      <section className={coupon.formSection}><div className={coupon.sectionHeading}><Bar w={130} h={20} /></div><div className="route-skeleton-stack"><Toolbar left={[[100, 38], [100, 38]]} /><Panel height={150} /></div></section>
      <section className={coupon.formSection}><div className={coupon.sectionHeading}><Bar w={150} h={20} /></div><Rows count={5} height={52} side={false} /></section>
      <div className={coupon.formActions}><Shapes sizes={[[85, 40], [120, 40]]} /></div>
    </div>
  </Frame>;
}

function ServiceEditorSkeleton() {
  return <Frame variant="serviceEditor"><Header />
    <div className="service-editor-form">{[3, 2, 3].map((count, index) => <section className="service-form-section" key={index}>
      <div className="service-form-section-heading"><Bar w={140} h={20} /><Bar w="80%" className="route-skeleton-gap" /></div>
      <div className="service-form-fields">{Array.from({ length: count }, (_, i) => <div className={`service-field${i === 0 ? " service-field-wide" : ""}`} key={i}><Bar w={110} /><Bar w="100%" h={index === 0 && i === 0 ? 100 : 42} /></div>)}</div>
    </section>)}</div>
  </Frame>;
}

function GenericSkeleton() {
  return (
    <Frame variant="generic">
      <Header />
      <Cards count={3} height={82} className="internal-page-skeleton-cards" />
      <Table columns={[2, 1, 1]} rows={5} />
    </Frame>
  );
}

const SKELETONS: Record<Exclude<InternalSkeletonVariant, "projectDetail" | "invoiceEditor" | "settings" | "clientDetail">, () => ReactNode> = {
  ticketDetail: TicketDetailSkeleton,
  reportDetail: ReportDetailSkeleton,
  invoiceDetail: InvoiceDetailSkeleton,
  subscriptionDetail: SubscriptionDetailSkeleton,
  couponEditor: CouponEditorSkeleton,
  serviceEditor: ServiceEditorSkeleton,
  dashboard: DashboardSkeleton,
  projects: ProjectsSkeleton,
  tickets: TicketsSkeleton,
  reporting: ReportingSkeleton,
  clients: ClientsSkeleton,
  operations: OperationsSkeleton,
  invoices: InvoicesSkeleton,
  subscriptions: SubscriptionsSkeleton,
  coupons: CouponsSkeleton,
  investmentIntent: InvestmentIntentSkeleton,
  services: ServicesSkeleton,
  forms: FormsSkeleton,
  team: TeamSkeleton,
  goals: GoalsSkeleton,
  goalDetail: GoalDetailSkeleton,
  conversations: ConversationsSkeleton,
  section: SectionSkeleton,
  generic: GenericSkeleton,
};

export function RouteSkeleton({ pathname }: { pathname: string }) {
  const variant = getInternalSkeletonVariant(pathname);
  if (variant === "settings") {
    const section = (pathname.split(/[?#]/)[0] ?? "").split("/")[2] as SettingsSection;
    return <SettingsSkeleton section={Object.hasOwn(SETTINGS_SECTION_LABELS, section) ? section : "general"} />;
  }
  if (variant === "clientDetail") {
    const tab = new URLSearchParams(pathname.split("?")[1]?.split("#")[0]).get("tab");
    return <ClientDetailSkeleton section={["projects", "invoices", "activities", "history"].includes(tab ?? "") ? tab as ClientSection : "details"} />;
  }
  if (variant === "invoiceEditor") {
    return <InvoiceEditorSkeleton editing={Boolean(pathname.split(/[?#]/)[0]?.replace(/\/+$/, "").endsWith("/edit"))} />;
  }
  if (variant === "projectDetail") {
    const path = pathname.split(/[?#]/)[0]?.replace(/\/+$/, "");
    return <ProjectDetailSkeleton section={path?.endsWith("/files") ? "files" : path?.endsWith("/history") ? "history" : "details"} />;
  }
  const Skeleton = SKELETONS[variant];
  return <Skeleton />;
}
