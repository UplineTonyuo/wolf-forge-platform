import type { CSSProperties, ReactNode } from "react";
import { portalTitleForPath } from "./portal-nav-registry";
import deck from "./dashboard/client-deck.module.css";
import flow from "./dashboard/next-action-flow.module.css";
import store from "./store/store-catalog.module.css";
import reports from "./reporting/client-reporting.module.css";
import payments from "./billing/payment-rails.module.css";
import security from "../settings/settings-workspace.module.css";
import styles from "./client-route-skeleton.module.css";
import forms from "../forms/forms.module.css";
import tickets from "../tickets/tickets.module.css";

function Bar({ width = "100%", height = 10 }: { width?: CSSProperties["width"]; height?: number }) {
  return <span className={`internal-page-skeleton-bar ${styles.bar}`} style={{ width, height }} />;
}

function Copy() {
  return <div className={styles.copy}><Bar width="72%" height={14} /><Bar width="92%" /><Bar width="56%" /></div>;
}

function Heading({ title, action = false }: { title: string; action?: boolean }) {
  return <header className={`portal-page-head ${action ? "portal-page-head-actions" : ""}`}>
    <div className={styles.heading}><h1>{title}</h1><Bar width="min(480px, 95%)" height={20} /></div>
    {action ? <span className={styles.action}><Bar width="80%" /></span> : null}
  </header>;
}

function Section({ children, description = false }: { children: ReactNode; description?: boolean }) {
  return <section className="portal-section">
    <header className="portal-section-head"><div className={styles.heading}><Bar width={170} height={20} />{description ? <Bar width="min(380px, 90%)" height={18} /> : null}</div></header>
    {children}
  </section>;
}

function ProjectRows({ count = 3 }: { count?: number }) {
  return <div className="portal-work-list" data-skeleton-block="project-rows">
    {Array.from({ length: count }, (_, index) => <div className="portal-work-row" key={index}>
      <div className={`portal-work-main ${styles.copy}`}><Bar width={85} /><Bar width="72%" height={15} /><Bar width="85%" /></div>
      <div className={`portal-work-meta ${styles.meta}`}><Bar width={95} height={24} /><Bar width={135} /></div>
    </div>)}
  </div>;
}

function MessageRows({ count = 4 }: { count?: number }) {
  return <div className="portal-message-list" data-skeleton-block="conversation-rows">
    {Array.from({ length: count }, (_, index) => <div className="portal-message-row" key={index}>
      <div className={`portal-message-main ${styles.copy}`}><Bar width={80} /><Bar width="75%" height={15} /><Bar width="62%" /></div>
      <div className="portal-message-meta"><Bar width={95} height={24} /></div>
    </div>)}
  </div>;
}

function InvoiceRows() {
  return <div className="portal-invoice-list" data-skeleton-block="invoice-rows">
    {[0, 1, 2].map((index) => <div className="portal-invoice-row" key={index}>
      <div className={`portal-invoice-main ${styles.copy}`}><div className={styles.inline}><Bar width={18} height={20} /><Bar width={115} height={15} /></div><Bar width="min(250px, 90%)" /></div>
      <Bar width={85} height={24} />
      <div className={`portal-invoice-amounts ${styles.amount}`}><Bar width={86} height={18} /><Bar width={70} /></div>
    </div>)}
  </div>;
}

function SubscriptionRows() {
  return <div className="portal-subscription-list" data-skeleton-block="subscription-rows">
    {[0, 1, 2].map((index) => <div className="portal-subscription-row" key={index}>
      <div className={`portal-subscription-main ${styles.copy}`}><Bar width="70%" height={15} /><Bar width="52%" /><Bar width={90} height={23} /></div>
      <div className={`portal-subscription-amount ${styles.amount}`}><Bar width={85} height={18} /><Bar width={65} /></div>
    </div>)}
  </div>;
}

function DashboardSkeleton() {
  return <div className="portal-dashboard">
    <section className={`${flow.hero} ${styles.navy}`} data-skeleton-block="welcome">
      <div className={`${flow.heroCopy} ${styles.grow}`}><Bar width={140} /><Bar width="80%" height={34} /><Bar width="95%" height={13} /></div>
      <div className={flow.heroAside}><Bar width={70} height={52} /><Bar width={90} /></div>
    </section>
    <Section><div className={styles.attention} data-skeleton-block="next-action"><div className={styles.copy}><Bar width={85} /><Bar width="70%" height={21} /><Bar width="90%" /></div><span className={styles.action}><Bar /></span></div></Section>
    <Section><div className={deck.rail} data-skeleton-block="active-work">{[0, 1, 2].map((index) => <div className={deck.railItem} key={index}><div className={deck.project}><Copy /><Bar width={120} /></div></div>)}</div></Section>
    <Section><div className={styles.billingStrip} data-skeleton-block="billing-strip">{[0, 1, 2].map((index) => <div className={styles.copy} key={index}><Bar width="60%" /><Bar width="70%" height={24} /></div>)}</div></Section>
    <Section><MessageRows count={2} /></Section>
  </div>;
}

function StoreSkeleton() {
  return <div className={store.store}>
    <header className={`${store.masthead} ${styles.navy}`} data-skeleton-block="catalogue-header">
      <div className={`${store.mastheadCopy} ${styles.grow}`}><Bar width={150} /><h1>Store</h1><Bar width="95%" height={13} /><Bar width="75%" height={13} /></div>
      <dl className={store.index}>{[0, 1].map((index) => <div key={index}><dt><Bar width={65} height={8} /></dt><dd><Bar width={40} height={26} /></dd></div>)}</dl>
    </header>
    <div className={store.controls} data-skeleton-block="catalogue-filters">
      <div className={store.controlRow}><span className={store.activeChip}><Bar width={120} /></span><span className={styles.filterAction}><Bar width={100} /></span></div>
      <div className={store.search}><Bar width="min(220px, 80%)" /></div>
    </div>
    <article className={store.spotlight} data-skeleton-block="featured-service">
      <div className={store.spotlightCopy}><Bar width={65} /><Bar width="80%" height={24} /><Copy /></div>
      <div className={`${store.spotlightAside} ${styles.spotlightAside}`}><Bar width={145} height={32} /><span className={styles.action}><Bar /></span></div>
    </article>
    <div className={store.section} data-skeleton-block="service-cards">
      <header className={store.sectionHead}><Bar width={170} height={18} /></header>
      <div className={store.grid}>{[0, 1, 2].map((index) => <article className={`${store.cardLink} ${styles.serviceCard}`} key={index}>
        <Bar width={75} height={20} /><Bar width="85%" height={22} /><Copy /><div className={styles.cardFoot}><Bar width={85} height={25} /><Bar width={32} height={32} /></div>
      </article>)}</div>
    </div>
  </div>;
}

function OnboardingSkeleton() {
  return <div className="portal-page"><Heading title="Orders" />
    <div className={styles.inline} data-skeleton-block="onboarding-progress"><Bar width={160} height={18} /><Bar width={120} /></div>
    {[0, 1].map((group) => <Section key={group} description><div className="portal-onboarding-list" data-skeleton-block="assigned-forms">
      {[0, 1].map((index) => <div className="portal-onboarding-row" key={index}>
        <span className="portal-onboarding-mark"><Bar width={18} height={18} /></span><div className={`portal-onboarding-body ${styles.copy}`}><Bar width="75%" height={14} /><Bar width="90%" /></div><span className="portal-onboarding-meta"><Bar width={85} height={24} /></span>
      </div>)}
    </div></Section>)}
  </div>;
}

function ReportingSkeleton() {
  return <div className="portal-page"><Heading title="Reporting" /><div className={reports.vault} data-skeleton-block="report-vault">
    {[0, 1, 2].map((index) => <div className={reports.report} key={index}><span className={reports.mark}><Bar width={23} height={23} /></span><div className={styles.copy}><Bar width={110} height={19} /><Bar width="80%" height={17} /><Bar width="60%" /></div><span className={reports.cta}><Bar width={100} /></span></div>)}
  </div></div>;
}

function PaymentSkeleton() {
  return <div className="portal-page"><Heading title="Payment method" /><div className={payments.stack}>
    <article className={payments.anchor} data-skeleton-block="wallet-card"><div className={`${styles.walletCard} ${styles.navy}`}><Bar width={100} /><Bar width="65%" height={30} /><Bar width="80%" /></div><div className={payments.anchorBody}><Bar width="70%" height={21} /><Bar width="50%" height={32} /><Copy /><div className={styles.inline}><span className={styles.action}><Bar /></span><Bar width={95} /></div></div></article>
    <Section description><div className={payments.rails} data-skeleton-block="payment-rails">{[0, 1].map((index) => <div className={styles.paymentRail} key={index}><Bar width={40} height={32} /><Copy /><Bar width={80} height={23} /></div>)}</div></Section>
    <Section description><div className={styles.copy} data-skeleton-block="wallet-history"><Bar width="75%" /><Bar width="60%" /></div></Section>
  </div></div>;
}

function ProfileSkeleton() {
  return <div className="portal-page">
    <Heading title="Profile" />
    <Section>
      <div className="portal-card portal-profile-card" data-skeleton-block="profile-details">
        <div className="portal-profile-avatar"><span className={styles.avatar}><Bar height={72} /></span><span className={styles.action}><Bar /></span></div>
        <div className="portal-form">
          {[0, 1, 2].map((index) => <div className="portal-field" key={index}><Bar width={115} height={16} /><Bar height={index === 0 ? 42 : 21} /></div>)}
          <div className="portal-toggle"><Bar width={18} height={18} /><div className={styles.copy}><Bar width={170} height={17} /><Bar width="min(340px, 95%)" height={17} /></div></div>
          <span className={styles.action}><Bar /></span>
        </div>
      </div>
    </Section>
    <div className="portal-security" data-skeleton-block="security-settings">
      <section className={security.section}>
        <div className={`${security.sectionHeading} ${styles.heading}`}><Bar width={100} height={20} /><Bar width={170} /></div>
        <div className={security.fields}>
          <div className={security.toggleRow}><Copy /><span className={styles.action}><Bar /></span></div>
          <div className={security.field}><Bar width={100} /><div className={security.methodList}><div className={security.methodRow}><Bar width={30} height={30} /><Copy /><Bar width={65} height={22} /></div></div><Bar width="90%" /></div>
        </div>
      </section>
    </div>
  </div>;
}

function ConversationSkeleton() {
  return <div className={styles.conversation} data-skeleton-block="conversation"><div className={styles.messageBubble}><Copy /></div><div className={`${styles.messageBubble} ${styles.outgoing}`}><Copy /></div><div className={styles.messageBubble}><Copy /></div><div className={styles.composer} data-skeleton-block="composer"><Bar height={36} /><div className={styles.editor}><Bar width="60%" /></div><div className={styles.cardFoot}><Bar width={80} height={38} /><span className={styles.action}><Bar /></span></div></div></div>;
}

function DetailSkeleton({ section, title }: { section: string; title: string }) {
  let content: ReactNode;
  switch (section) {
    case "onboarding":
      return <div className={forms.clientFormPage}>
        <Bar width={115} height={14} />
        <div className={forms.clientAssignmentContext}><Copy /><Bar width="45%" /></div>
        <div className={forms.renderer} data-skeleton-block="assignment-content">
          <div className={forms.rendererHeader}><Bar width="70%" height={25} /></div>
          <div className={styles.assignmentContent}><Copy /><Bar height={90} /><Copy /></div>
        </div>
      </div>;
    case "messages":
      content = <div className={tickets.clientDetailGrid}><div className={tickets.detailMain}><ConversationSkeleton /></div><aside className={tickets.clientSummary}><Copy /><Copy /></aside></div>;
      break;
    case "projects":
      content = <><Section><div className="portal-card" data-skeleton-block="project-progress"><Bar width="35%" /><Bar height={6} /></div></Section><Section><div className="portal-fact-grid">{[0, 1, 2, 3, 4, 5].map((index) => <Copy key={index} />)}</div></Section><ConversationSkeleton /></>;
      break;
    case "store":
      content = <div className={styles.serviceDetail} data-skeleton-block="service-detail"><div className={styles.copy}><Bar height={38} /><Copy /><Copy /><Copy /></div><div className="portal-card"><Bar width="65%" height={35} /><Bar height={44} /><Copy /></div></div>;
      break;
    case "invoices":
      content = <><div className={styles.facts} data-skeleton-block="invoice-facts">{[0, 1, 2].map((index) => <Copy key={index} />)}</div>
        <div className={styles.serviceDetail}>
          <div data-skeleton-block="invoice-line-items">{[0, 1, 2, 3].map((index) => <div className="client-invoice-item" key={index}><Copy /><Bar width={25} /><Bar width={65} /><Bar width={65} /></div>)}</div>
          <div className="client-invoice-totals"><Copy /><Bar height={44} /></div>
        </div></>;
      break;
    case "subscriptions":
      content = <><div className={styles.facts} data-skeleton-block="subscription-facts">{[0, 1, 2].map((index) => <Copy key={index} />)}</div><Section><div className="portal-card"><Copy /><Copy /></div></Section><Section><InvoiceRows /></Section></>;
      break;
    default:
      content = <div className={`${styles.reportDocument} portal-card`} data-skeleton-block="report-document"><Bar width="70%" height={30} /><Copy /><div className={styles.chart} /><Copy /></div>;
  }
  return <div className="portal-page"><Bar width={115} height={14} /><Heading title={title} />{content}</div>;
}

function RouteSkeleton({ section, detail, title }: { section: string; detail: boolean; title: string }) {
  if (detail && ["projects", "messages", "onboarding", "store", "invoices", "subscriptions", "reporting"].includes(section)) return <DetailSkeleton section={section} title={title} />;
  switch (section) {
    case "dashboard": return <DashboardSkeleton />;
    case "store": return <StoreSkeleton />;
    case "projects": return <div className="portal-page"><Heading title="Orders" /><Section><ProjectRows count={4} /></Section></div>;
    case "onboarding": return <OnboardingSkeleton />;
    case "messages": return <div className="portal-page"><Heading title="Tickets" action /><MessageRows /></div>;
    case "reporting": return <ReportingSkeleton />;
    case "invoices": return <div className="portal-page"><Heading title="Invoices" /><section className="portal-balance" data-skeleton-block="outstanding-balance"><Bar width={150} /><Bar width={175} height={38} /><Bar width={220} /></section><Section><InvoiceRows /></Section></div>;
    case "subscriptions": return <div className="portal-page"><Heading title="Subscriptions" /><Section><SubscriptionRows /></Section></div>;
    case "payment-method": return <PaymentSkeleton />;
    case "profile": return <ProfileSkeleton />;
    default: return <div className="portal-page"><Heading title={title} /><div className="portal-card"><Copy /></div></div>;
  }
}

export function ClientRouteSkeleton({ pathname }: { pathname: string }) {
  const path = (pathname.split(/[?#]/)[0] ?? "/account").replace(/\/+$/, "") || "/account";
  const title = portalTitleForPath(path);
  const [, root, segment, record] = path.split("/");
  const section = path === "/account" ? "dashboard" : root === "account" ? segment ?? "unknown" : "unknown";
  const detail = Boolean(record);

  return <div className={styles.skeleton} role="status" aria-label={`Loading ${title}`} data-client-skeleton={path} data-skeleton-layout={`${section}${detail ? "-detail" : ""}`}>
    <span className="sr-only">Loading {title}</span>
    <div aria-hidden="true"><RouteSkeleton section={section} detail={detail} title={title} /></div>
  </div>;
}
