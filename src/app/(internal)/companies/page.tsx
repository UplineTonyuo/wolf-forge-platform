import type { Metadata } from "next";
import { ArrowRight, Building2, Plus } from "lucide-react";
import Link from "next/link";
import { AccountAvatar } from "../../../components/ui/account-avatar";
import { EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { formatDate } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "../../../components/companies/company-experience.module.css";

export const metadata: Metadata = { title: "Companies" };

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default async function CompaniesPage() {
  const context = await getInternalContext();

  try {
    const companies = await context.services.companies.listActive();
    const contacts = context.user.clients.privateManage
      ? await context.services.contacts.listForCompanies(companies.map((company) => company.id))
      : [];
    const profileIds = contacts.map((contact) => contact.profile_id).filter((id): id is string => Boolean(id));
    const profiles = profileIds.length
      ? await context.client.from("profiles").select("id, avatar_url").in("id", profileIds).is("archived_at", null)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const avatars = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.avatar_url]));
    const people = new Map(companies.map((company) => [company.id, contacts.filter((contact) => contact.company_id === company.id)]));

    return (
      <PageFrame
        title="Companies"
        description="Business entities and the people connected to them."
        className={styles.page}
        action={context.user.clients.create ? <Link className={styles.primaryButton} href="/companies/new"><Plus aria-hidden="true" />Add Company</Link> : null}
      >
        {companies.length === 0 ? (
          <EmptyState
            title="No Companies yet"
            body="Create a Company record without creating a login or subscription."
            action={context.user.clients.create ? <Link className={styles.primaryButton} href="/companies/new">Add Company</Link> : undefined}
          />
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Company</th><th>People</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                  {companies.map((company) => {
                    const companyPeople = people.get(company.id) ?? [];
                    return (
                      <tr key={company.id}>
                        <td><Link className={styles.companyLink} href={`/companies/${company.id}`}><Building2 aria-hidden="true" /><span>{company.name}</span></Link></td>
                        <td>
                          {context.user.clients.privateManage ? (
                            companyPeople.length ? (
                              <div className={styles.avatarStack} aria-label={`${companyPeople.length} ${companyPeople.length === 1 ? "person" : "people"}`}>
                                {companyPeople.slice(0, 4).map((person) => {
                                  const identity = person.email ? `${person.name}, ${person.email}` : person.name;
                                  return <span className={styles.avatarItem} key={person.id} title={identity} tabIndex={0}><AccountAvatar name={person.name} avatarUrl={avatars.get(person.profile_id ?? "")} size={32} fallback={<span className={styles.initials}>{initials(person.name)}</span>} /><span className="sr-only">{identity}</span></span>;
                                })}
                                {companyPeople.length > 4 ? <span className={styles.avatarOverflow} title={`${companyPeople.length - 4} more people`}>+{companyPeople.length - 4}</span> : null}
                              </div>
                            ) : <span className={styles.muted}>No people</span>
                          ) : <span className={styles.muted}>Restricted</span>}
                        </td>
                        <td><time dateTime={company.created_at}>{formatDate(company.created_at)}</time></td>
                        <td><Link className={styles.rowAction} href={`/companies/${company.id}`}>View<ArrowRight aria-hidden="true" /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.mobileList}>
              {companies.map((company) => {
                const companyPeople = people.get(company.id) ?? [];
                return (
                  <Link className={styles.mobileCard} href={`/companies/${company.id}`} key={company.id}>
                    <span className={styles.mobileIdentity}><Building2 aria-hidden="true" /><strong>{company.name}</strong></span>
                    <span><b>People</b>{context.user.clients.privateManage ? companyPeople.length : "Restricted"}</span>
                    <span><b>Created</b>{formatDate(company.created_at)}</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </PageFrame>
    );
  } catch (error) {
    return <PageFrame title="Companies"><div className={styles.error} role="alert"><strong>Companies could not be loaded.</strong><span>{toClientSafeError(error).message}</span></div></PageFrame>;
  }
}
