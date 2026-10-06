import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, Check, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyActions } from "../../../../components/companies/company-actions";
import styles from "../../../../components/companies/company-experience.module.css";
import { AccountAvatar } from "../../../../components/ui/account-avatar";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatDate } from "../../../../lib/format";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Company" };

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { companyId } = await params;
  const query = await searchParams;
  const context = await getInternalContext();

  try {
    const company = await context.services.companies.get(companyId);
    const people = context.user.clients.privateManage
      ? await context.services.contacts.listForCompany(companyId)
      : [];
    const profileIds = people.map((person) => person.profile_id).filter((id): id is string => Boolean(id));
    const profiles = profileIds.length
      ? await context.client.from("profiles").select("id, avatar_url").in("id", profileIds).is("archived_at", null)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const avatars = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.avatar_url]));

    return (
      <PageFrame
        title={company.name}
        description="Company record"
        className={styles.page}
        action={<CompanyActions companyId={company.id} companyName={company.name} canAddPerson={context.user.clients.create && context.user.clients.privateManage} canEdit={context.user.clients.edit} />}
      >
        {query.created === "1" ? <div className={styles.success} role="status">{company.name} created. No login or subscription was created.</div> : null}
        <Link className={styles.backLink} href="/companies"><ArrowLeft aria-hidden="true" />Companies</Link>

        <section className={styles.identitySection} aria-labelledby="company-identity-heading">
          <h2 id="company-identity-heading">Company details</h2>
          <dl>
            <div><dt><CalendarDays aria-hidden="true" />Created</dt><dd>{formatDate(company.created_at)}</dd></div>
            <div><dt><CalendarDays aria-hidden="true" />Updated</dt><dd>{formatDate(company.updated_at)}</dd></div>
          </dl>
        </section>

        <section className={styles.peopleSection} aria-labelledby="company-people-heading">
          <header><div><h2 id="company-people-heading">People{context.user.clients.privateManage ? ` (${people.length})` : ""}</h2><p>People linked to this business entity. Portal access is shown separately.</p></div></header>

          {!context.user.clients.privateManage ? (
            <div className={styles.restricted}><ShieldCheck aria-hidden="true" /><div><strong>Private contact access required</strong><p>You can view the Company without loading private contact or wallet data.</p></div></div>
          ) : people.length === 0 ? (
            <div className={styles.emptyPeople}><UserRound aria-hidden="true" /><div><strong>No people linked</strong><p>This Company is valid without a contact or portal user.</p></div></div>
          ) : (
            <div className={styles.peopleList}>
              {people.map((person) => (
                <article className={styles.personRow} key={person.id}>
                  <AccountAvatar name={person.name} avatarUrl={avatars.get(person.profile_id ?? "")} size={42} fallback={<span className={styles.initials}>{initials(person.name)}</span>} />
                  <div className={styles.personIdentity}><div><strong>{person.name}</strong>{person.is_primary ? <span className={styles.primaryBadge}><Check aria-hidden="true" />Primary</span> : null}</div>{person.email ? <span><Mail aria-hidden="true" />{person.email}</span> : <span className={styles.muted}>No email</span>}<small>{person.job_title ? `${person.job_title} · ` : ""}Added {formatDate(person.created_at)}</small></div>
                  <div className={styles.accessState}>{person.profile_id ? <><KeyRound aria-hidden="true" /><span><strong>Portal access</strong><small>Company portal</small></span></> : <><UserRound aria-hidden="true" /><span><strong>Contact only</strong><small>No authenticated identity</small></span></>}</div>
                </article>
              ))}
            </div>
          )}

          {context.user.clients.privateManage && context.user.clients.create && context.user.team.create ? (
            <p className={styles.portalProvision}>Need to create portal credentials? <Link href={`/accounts/client/new?companyId=${company.id}`}>Provision a portal user</Link>.</p>
          ) : null}
        </section>
      </PageFrame>
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "NOT_FOUND") notFound();
    return <PageFrame title="Company"><div className={styles.error} role="alert"><strong>Company could not be loaded.</strong><span>{safe.message}</span></div></PageFrame>;
  }
}
