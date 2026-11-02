import type { ReactNode } from "react";
import styles from "./settings-foundation.module.css";
import profile from "./settings-workspace.module.css";
import manual from "../invoices/invoice-manual-payment.module.css";

export type SettingsSection = "general" | "team" | "billing" | "integrations" | "notifications" | "security";
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General", team: "Team & Access", billing: "Billing & Payments",
  integrations: "Integrations", notifications: "Notifications", security: "Security",
};

function Bar({ width = "100%", height = 12, round = 4 }: { width?: number | string; height?: number; round?: number }) {
  return <span className="internal-page-skeleton-bar" style={{ width, height, borderRadius: round }} />;
}
function Copy() {
  return <div className={styles.sectionHeading}><Bar width={95} height={9} /><h2><Bar width="80%" height={17} /></h2><p><Bar /><br /><Bar width="85%" /></p></div>;
}
function Card({ children }: { children: ReactNode }) {
  return <section className={styles.surfaceSection}><Copy />{children}</section>;
}
function FoundationRows({ count }: { count: number }) {
  return <ul className={styles.foundationList}>{Array.from({ length: count }, (_, i) => <li key={i}><Bar width="55%" /><Bar width="25%" height={10} /></li>)}</ul>;
}
function Footer() {
  return <div className={styles.formFooter}><Bar width="45%" height={10} /><Bar width={130} height={38} /></div>;
}
function ProfileFields() {
  return <div className={profile.fields}>{[0, 1].map(i => <div key={i} className={profile.field}><Bar width={90} height={10} /><Bar height={40} /><Bar width="70%" height={10} /></div>)}</div>;
}

/** Same structural CSS as each real Settings page; no account data or active controls. */
export function SettingsSkeletonBody({ section }: { section: SettingsSection }) {
  return <div data-settings-section={section}>
    <header className={styles.pageIntro}><h2><Bar width={section === "billing" ? 200 : 150} height={22} /></h2><p><Bar width="90%" height={20} /></p></header>
    {section === "general" ? <>
      <div className={profile.page}>
        <div className={profile.identity}><div className={profile.avatarBlock}><Bar width={92} height={92} round={46} /></div><div className={profile.identityCopy}><Bar width="60%" height={25} /><Bar width="45%" /><Bar width={90} height={24} /></div></div>
        {[0, 1].map(i => <section className={profile.section} key={i}><div className={profile.sectionHeading}><Bar width={95} height={17} /><p><Bar /></p></div><ProfileFields /></section>)}
        <div className={profile.footer}><div /><Bar width={120} height={38} /></div>
      </div>
      <Card><dl className={styles.readOnlyGrid}>{[0, 1, 2, 3].map(i => <div key={i}><dt><Bar width="75%" /></dt><dd><Bar /><br /><Bar width="80%" /></dd></div>)}</dl></Card>
    </> : null}
    {section === "team" ? <div className={styles.sectionStack}>
      <div className={styles.teamSummary}>{[0, 1, 2].map(i => <div className={styles.teamMetric} key={i}><Bar width="70%" height={10} /><Bar width={45} height={26} /></div>)}</div>
      <Card><div><FoundationRows count={4} /><div className={styles.textLink}><Bar width={130} height={16} /></div></div></Card>
    </div> : null}
    {section === "billing" ? <>
      <section className={manual.panel}><header className={manual.heading}><div><Bar width={190} height={20} /><p><Bar width="90%" /></p></div></header>
        <div className={manual.form}><Bar width={240} height={18} />
          <div className={manual.field}><Bar width={120} height={10} /><Bar height={40} /></div>
          <div className={manual.field}><Bar width={140} height={10} /><Bar height={118} /></div>
          <div className={manual.actions}><Bar width={185} height={40} /></div>
        </div>
      </section>
      <div className={styles.sectionStack}><section className={styles.panel}><div className={styles.panelHeading}><Bar width={170} height={18} /><p><Bar width="85%" /></p></div>
        <ul className={styles.rowList}>{[0, 1].map(i => <li className={styles.row} key={i}><Bar width={90} /><Bar width={100} height={24} /></li>)}</ul>
        <div className={styles.panelFooter}><Bar width={135} height={16} /></div>
      </section><div className={styles.callout}><Bar height={44} /></div></div>
    </> : null}
    {section === "integrations" ? <>
      <div className={styles.callout}><Bar width="25%" height={30} /><Bar width="65%" height={40} /></div>
      <div className={styles.providerList}>{[0, 1, 2].map(i => <article className={styles.providerCard} key={i}><div className={styles.providerMain}>
        <Bar width={46} height={46} round={10} />
        <div className={styles.providerCopy}><div className={styles.providerTitleRow}><Bar width={75} height={18} /><Bar width={90} height={20} /></div><p><Bar width="90%" height={26} /></p></div>
        <span className={styles.providerAction}><Bar width={70} height={16} /></span>
      </div></article>)}</div>
    </> : null}
    {section === "notifications" ? <div className={styles.sectionStack}>
      <Card><div className={styles.preferenceRow}><span><strong><Bar width="80%" /></strong><small><Bar height={26} /></small></span><Bar width={18} height={18} /></div></Card>
      <Card><FoundationRows count={4} /></Card><Footer />
    </div> : null}
    {section === "security" ? <section className={profile.section}><div /><div className={profile.fields}>
      <div className={profile.toggleRow}><div className={profile.toggleCopy}><Bar width={80} /><Bar width="90%" height={42} /></div><Bar width={165} height={38} /></div>
      <div className={profile.field}><Bar width={115} height={10} /><div className={profile.methodList}><div className={profile.methodRow}><span className={profile.methodIcon}><Bar width={20} height={20} /></span><span className={profile.methodCopy}><Bar width={70} /><Bar width={130} height={10} /></span><Bar width={65} height={24} /></div></div><p className={profile.securityNote}><Bar width="85%" height={36} /></p></div>
    </div></section> : null}
  </div>;
}
