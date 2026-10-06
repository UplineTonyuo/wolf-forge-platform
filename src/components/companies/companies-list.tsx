"use client";

import { Building2, Filter, Plus, Search, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterOptionList, type FilterOptionRow } from "../projects/project-filter-option-list";
import { useExitTransition } from "../team/use-exit-transition";
import toolbar from "../tickets/tickets.module.css";
import { AccountAvatar } from "../ui/account-avatar";
import { RowActionMenu } from "../ui/row-action-menu";
import styles from "./company-experience.module.css";

export type CompanyListPerson = { id: string; name: string; email: string | null; avatarUrl: string | null };
export type CompanyListRow = { id: string; name: string; createdAt: string; createdLabel: string; people: CompanyListPerson[] };
type PeopleFilter = "all" | "with" | "without";

const peopleRows: FilterOptionRow[] = [
  { id: "all", label: "All", icon: <Building2 size={16} aria-hidden="true" /> },
  { id: "with", label: "Has people", icon: <UsersRound size={16} aria-hidden="true" /> },
  { id: "without", label: "No people", icon: <UserRound size={16} aria-hidden="true" /> },
];

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function firstName(name: string) {
  return name.trim().split(/\s+/u)[0] ?? name;
}

/**
 * The Companies list with the Tickets toolbar hierarchy: local search on the
 * left, Filter and the primary create action on the right. It reuses the
 * Tickets toolbar and filter-panel classes and the shared Projects option rows
 * rather than a Companies copy of them. Filtering is client-side over the rows
 * the page already loaded, so search adds no query.
 */
export function CompaniesList({
  companies,
  canSeePeople,
  canCreate,
}: {
  companies: CompanyListRow[];
  /** False without clients.privateManage: no people were loaded, so people search and the People filter are off. */
  canSeePeople: boolean;
  canCreate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PeopleFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const { render: filterRendered } = useExitTransition(filterOpen, 150);
  const filterAreaRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  function closeFilter(returnFocus: boolean) {
    setFilterOpen(false);
    if (returnFocus) filterTriggerRef.current?.focus();
  }

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterAreaRef.current?.contains(event.target)) setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      filterTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return companies.filter((company) => {
      const searchable = [company.name, ...company.people.flatMap((person) => [person.name, person.email])].filter(Boolean).join(" ").toLocaleLowerCase();
      const peopleMatch = people === "all" || (people === "with" ? company.people.length > 0 : company.people.length === 0);
      return (!term || searchable.includes(term)) && peopleMatch;
    });
  }, [companies, people, query]);

  return (
    <section className={toolbar.listSurface} aria-label="Companies">
      <div className={toolbar.listToolbar} ref={filterAreaRef}>
        <label className={toolbar.searchField}>
          <Search aria-hidden="true" />
          <span className="sr-only">Search Companies</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={canSeePeople ? "Search company or person..." : "Search companies..."}
            autoComplete="off"
          />
        </label>
        {canSeePeople ? (
          <button
            ref={filterTriggerRef}
            type="button"
            className={filterOpen ? toolbar.filterButtonActive : toolbar.filterButton}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((current) => !current)}
          >
            <Filter size={15} aria-hidden="true" />
            Filter
            {people !== "all" ? <span className={toolbar.filterCount}>1</span> : null}
          </button>
        ) : null}
        {canCreate ? (
          <Link className={`${toolbar.addTicketButton} ${canSeePeople ? "" : styles.pushRight}`} href="/companies/new">
            <Plus size={16} aria-hidden="true" />
            Company
          </Link>
        ) : null}

        {filterRendered ? (
          <div className={`${toolbar.filterPanel} ${filterOpen ? "" : styles.filterPanelClosing}`} role="dialog" aria-label="Filters">
            <div className={toolbar.filterSection}>
              <span className={toolbar.filterSectionLabel}>People</span>
              <FilterOptionList options={peopleRows} selectedId={people} onSelect={(id) => setPeople(id as PeopleFilter)} />
            </div>
            <div className={toolbar.filterPanelFooter}>
              <button type="button" className={toolbar.filterClearButton} onClick={() => setPeople("all")}>Clear filters</button>
              <button type="button" className={toolbar.filterApplyButton} onClick={() => closeFilter(true)}>Apply filters</button>
            </div>
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className={styles.noMatches} role="status">
          <strong>No Companies match.</strong>
          <span>Try a broader search or clear a filter.</span>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Company Name</th><th>People</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>
                {visible.map((company) => (
                  <tr key={company.id}>
                    <td><Link className={styles.companyLink} href={`/companies/${company.id}`}><Building2 aria-hidden="true" /><span>{company.name}</span></Link></td>
                    <td>
                      {canSeePeople ? (
                        company.people.length ? (
                          <div className={styles.avatarStack} aria-label={`${company.people.length} ${company.people.length === 1 ? "person" : "people"}`}>
                            {company.people.slice(0, 4).map((person) => (
                              <span className={styles.avatarItem} key={person.id} title={firstName(person.name)} tabIndex={0}>
                                <AccountAvatar name={person.name} avatarUrl={person.avatarUrl} size={32} fallback={<span className={styles.initials}>{initials(person.name)}</span>} />
                                <span className="sr-only">{person.name}</span>
                              </span>
                            ))}
                            {company.people.length > 4 ? <span className={styles.avatarOverflow} title={`${company.people.length - 4} more people`}>+{company.people.length - 4}</span> : null}
                          </div>
                        ) : <span className={styles.muted}>No people</span>
                      ) : <span className={styles.muted}>Restricted</span>}
                    </td>
                    <td><time dateTime={company.createdAt}>{company.createdLabel}</time></td>
                    <td className={styles.actionsCell}><RowActionMenu name={company.name} items={[{ label: "Open company", href: `/companies/${company.id}` }]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileList}>
            {visible.map((company) => (
              <Link className={styles.mobileCard} href={`/companies/${company.id}`} key={company.id}>
                <span className={styles.mobileIdentity}><Building2 aria-hidden="true" /><strong>{company.name}</strong></span>
                <span><b>People</b>{canSeePeople ? company.people.length : "Restricted"}</span>
                <span><b>Created</b>{company.createdLabel}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
