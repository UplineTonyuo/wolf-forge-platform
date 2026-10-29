import type { CSSProperties, ReactNode } from "react";
import { TasksLoading } from "../operations/tasks-loading";
import supervisionRows from "../team-supervision/supervised-conversation-list.module.css";
import supervision from "../team-supervision/supervised-transcript.module.css";
import tickets from "../tickets/tickets.module.css";

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
  if (/^\/clients\/[^/]+$/.test(path) && path !== "/clients/new") return "clientDetail";
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
}: {
  className?: string;
  variant: InternalSkeletonVariant;
  children: ReactNode;
}) {
  return (
    <div className={`${className} internal-page-skeleton`} data-skeleton={variant} role="status" aria-label={variant === "section" ? "Loading section" : undefined}>
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

function Fields({ count }: { count: number }) {
  return (
    <div className="route-skeleton-fields">
      {Array.from({ length: count }, (_, field) => (
        <div key={field}>
          <Bar w={110} h={9} />
          <Bar w="100%" h={40} r={6} />
        </div>
      ))}
    </div>
  );
}

/* ---------- destination compositions ---------- */

export function ClientDetailSkeleton() {
  return <Frame variant="clientDetail">
    <Header subtitle={false} actions={[[86, 36]]} />
    <div className="client-detail-context"><Bar w={85} h={18} /><Bar w={90} h={32} /></div>
    <div className="client-detail-tabs"><Shapes sizes={[[92, 36], [102, 36], [100, 36], [108, 36], [92, 36]]} /></div>
    <div className="client-detail-content">
      <section className="client-information-panel">
        <div className="client-section-heading"><Bar w={160} h={20} /></div>
        <dl className="client-information-list">{Array.from({ length: 6 }, (_, i) => <div key={i}><dt><Bar w={100} /></dt><dd><Bar w="70%" /></dd></div>)}</dl>
      </section>
      <section className="client-side-summary">
        <div className="client-section-heading"><Bar w={140} h={20} /></div>
        <Rows count={3} side={false} />
      </section>
    </div>
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
      <Header />
      <Toolbar left={[[65, 34], [86, 34], [77, 34]]} right={[[129, 40]]} r={999} />
      <Rows count={6} height={72} />
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

function SettingsSkeleton() {
  return (
    <div className="settings-page-layout">
      <Frame variant="settings">
        <Header />
        <Split columns="210px minmax(0, 1fr)">
          <div className="route-skeleton-nav">
            {Array.from({ length: 6 }, (_, link) => (
              <Bar key={link} w="100%" h={38} r={6} />
            ))}
          </div>
          <div className="route-skeleton-stack">
            <Bar w={160} h={20} />
            <Bar w="60%" h={10} />
            <Fields count={5} />
          </div>
        </Split>
      </Frame>
    </div>
  );
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

const SKELETONS: Record<InternalSkeletonVariant, () => ReactNode> = {
  dashboard: DashboardSkeleton,
  projects: ProjectsSkeleton,
  tickets: TicketsSkeleton,
  reporting: ReportingSkeleton,
  clients: ClientsSkeleton,
  clientDetail: ClientDetailSkeleton,
  operations: OperationsSkeleton,
  invoices: InvoicesSkeleton,
  subscriptions: SubscriptionsSkeleton,
  coupons: CouponsSkeleton,
  investmentIntent: InvestmentIntentSkeleton,
  services: ServicesSkeleton,
  forms: FormsSkeleton,
  team: TeamSkeleton,
  conversations: ConversationsSkeleton,
  settings: SettingsSkeleton,
  section: SectionSkeleton,
  generic: GenericSkeleton,
};

export function RouteSkeleton({ pathname }: { pathname: string }) {
  const Skeleton = SKELETONS[getInternalSkeletonVariant(pathname)];
  return <Skeleton />;
}
