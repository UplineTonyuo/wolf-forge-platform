import type { Metadata } from "next";
import Link from "next/link";
import { CompaniesList, type CompanyListRow } from "../../../components/companies/companies-list";
import { EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { formatDate } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";
import styles from "../../../components/companies/company-experience.module.css";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const context = await getInternalContext();

  try {
    // Only explicit Company / Team entities. Client records (and their business
    // names) live in `companies` and never appear here.
    const companies = await context.services.organizations.listActive();
    const members = context.user.clients.privateManage
      ? await context.services.organizations.listMembers(companies.map((company) => company.id))
      : [];
    const profileIds = members.map(({ contact }) => contact.profile_id).filter((id): id is string => Boolean(id));
    const profiles = profileIds.length
      ? await context.client.from("profiles").select("id, avatar_url").in("id", profileIds).is("archived_at", null)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const avatars = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.avatar_url]));
    const people = new Map(companies.map((company) => [
      company.id,
      members.filter((member) => member.organizationId === company.id).map((member) => member.contact),
    ]));

    const rows: CompanyListRow[] = companies.map((company) => ({
      id: company.id,
      name: company.name,
      createdAt: company.created_at,
      createdLabel: formatDate(company.created_at),
      people: (people.get(company.id) ?? []).map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        avatarUrl: avatars.get(person.profile_id ?? "") ?? null,
      })),
    }));

    return (
      <PageFrame title="Companies" description="Companies and teams, and the people who belong to them." className={styles.page}>
        {companies.length === 0 ? (
          <EmptyState
            title="No Companies yet"
            body="Create a Company record without creating a login or subscription."
            action={context.user.clients.create ? <Link className={styles.primaryButton} href="/companies/new">Add Company</Link> : undefined}
          />
        ) : (
          <CompaniesList companies={rows} canSeePeople={context.user.clients.privateManage} canCreate={context.user.clients.create} />
        )}
      </PageFrame>
    );
  } catch (error) {
    return <PageFrame title="Companies"><div className={styles.error} role="alert"><strong>Companies could not be loaded.</strong><span>{toClientSafeError(error).message}</span></div></PageFrame>;
  }
}
