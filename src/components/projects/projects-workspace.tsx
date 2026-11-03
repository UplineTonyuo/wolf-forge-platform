"use client";

import {
  BellRing,
  Building2,
  Check,
  Filter,
  ListChecks,
  ListFilter,
  Search,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkArchiveProjectsAction,
  bulkAssignProjectsAction,
  bulkChangeProjectStatusAction,
} from "../../app/actions/orders";
import {
  PROJECTS_BULK_ACTION_EVENT,
  PROJECTS_SELECTION_EVENT,
  type ProjectBulkActionDetail,
  type ProjectSelectionDetail,
} from "./projects-events";
import {
  describeProjectBulkResult,
  failedProjectBatch,
  type ProjectBulkResult,
} from "../../domain/orders/bulk";
import {
  countProjectsByStatus,
  countUnansweredOrders,
  filterProjectRows,
  projectInitials,
  projectStatusLabels,
  type ProjectCapabilities,
  type ProjectFilterCriteria,
  type ProjectListRow,
  type ProjectTab,
} from "../../domain/orders/projections";
import { orderStatuses } from "../../domain/orders/schema";
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { ProjectsFilterSheet } from "./projects-filter-sheet";
import { ProjectServiceFilterPicker } from "./project-service-filter-picker";
import { ProjectSimpleFilterPicker } from "./project-simple-filter-picker";
import type { SimpleFilterOption } from "./project-simple-filter-content";
import type { ServiceFilterOption } from "./use-service-folder-filter";
import { ProjectsHeaderActions } from "./projects-header-actions";
import styles from "./projects-workspace.module.css";

export type ProjectOption = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

const TABS: Array<{ value: ProjectTab; label: string }> = [
  {
    value: "working",
    label: "Working",
  },
  {
    value: "waiting_reply",
    label: "Waiting Reply",
  },
  {
    value: "pending_update",
    label: "Pending Update",
  },
  {
    value: "all",
    label: "All",
  },
];

type DialogKind = "status" | "assign" | "archive";

type DialogState = {
  kind: DialogKind;
  ids: string[];
};

const dialogTitles: Record<DialogKind, string> = {
  status: "Change order status",
  assign: "Assign orders",
  archive: "Archive orders",
};

export function ProjectsWorkspace({
  rows,
  complete,
  people,
  services,
  serviceFolders,
  clients,
  capabilities,
  viewerId,
}: {
  rows: ProjectListRow[];
  complete: boolean;
  people: ProjectOption[];
  services: ServiceFilterOption[];
  serviceFolders: ServiceFolderRow[];
  clients: ProjectOption[];
  capabilities: ProjectCapabilities;
  viewerId?: string;
}) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<ProjectTab>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProjectBulkResult | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogChoiceRef = useRef<HTMLSelectElement>(null);
  const dialogConfirmRef = useRef<HTMLButtonElement>(null);
  const unknownResponseCount = rows.filter((row) => row.unanswered === null).length;
  const responseStatesAvailable = rows.length === 0 || unknownResponseCount < rows.length;

  /* One criteria object feeds counts, filtering and the attention view, so the
     tab totals and the rendered rows can never disagree. */
  const scopeCriteria = useMemo<ProjectFilterCriteria>(
    () => ({
      tab: "all",
      search,
      assigneeId: personFilter,
      serviceId: serviceFilter,
      companyId: clientFilter,
      unansweredOnly: unansweredOnly && responseStatesAvailable,
    }),
    [unansweredOnly, responseStatesAvailable, clientFilter, personFilter, search, serviceFilter],
  );

  const counts = useMemo(() => countProjectsByStatus(rows, scopeCriteria), [rows, scopeCriteria]);

  const filteredProjects = useMemo(
    () => filterProjectRows(rows, { ...scopeCriteria, tab: activeTab }),
    [activeTab, rows, scopeCriteria],
  );

  const unansweredCount = useMemo(() => countUnansweredOrders(rows), [rows]);

  const allVisibleSelected =
    filteredProjects.length > 0 && filteredProjects.every((project) => selected.has(project.id));

  const activeFilterCount =
    Number(personFilter !== "all") +
    Number(serviceFilter !== "all") +
    Number(clientFilter !== "all") +
    Number(activeTab !== "all") +
    Number(scopeCriteria.unansweredOnly) +
    Number(search.trim().length > 0);

  const personOptions: SimpleFilterOption[] = useMemo(
    () => [
      ...(viewerId ? [{ id: viewerId, label: "Assigned to me" }] : []),
      ...people.filter((person) => person.id !== viewerId).map((person) => ({ id: person.id, label: person.name, avatarUrl: person.avatarUrl ?? null })),
    ],
    [people, viewerId],
  );

  const clientOptions: SimpleFilterOption[] = useMemo(
    () => clients.map((client) => ({ id: client.id, label: client.name, icon: <Building2 size={16} aria-hidden="true" /> })),
    [clients],
  );

  const statusOptions: SimpleFilterOption[] = useMemo(
    () => orderStatuses.map((status) => ({ id: status, label: projectStatusLabels[status], status })),
    [],
  );

  const selectedPersonName =
    personFilter === "all"
      ? "Everyone"
      : personFilter === "unassigned"
        ? "Unassigned"
        : personFilter === viewerId ? "Assigned to me"
        : (people.find((person) => person.id === personFilter)?.name ?? "Everyone");

  const selectedClientName =
    clientFilter === "all" ? "All clients" : (clients.find((client) => client.id === clientFilter)?.name ?? "All clients");

  const selectedStatusName = activeTab === "all" ? "All statuses" : projectStatusLabels[activeTab];

  const selectedIds = useMemo(
    () => rows.filter((project) => selected.has(project.id)).map((project) => project.id),
    [rows, selected],
  );

  const selectedCount = selectedIds.length;

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<ProjectSelectionDetail>(
        PROJECTS_SELECTION_EVENT,
        {
          detail: { count: selectedCount },
        },
      ),
    );
  }, [selectedCount]);

  useEffect(() => {
    function onBulkAction(event: Event) {
      const detail = (event as CustomEvent<ProjectBulkActionDetail>).detail;

      if (!detail || selectedIds.length === 0) {
        return;
      }

      setFilterOpen(false);
      setOpenRowMenu(null);
      setResult(null);
      setDialog({
        kind: detail.kind,
        ids: selectedIds,
      });
    }

    window.addEventListener(
      PROJECTS_BULK_ACTION_EVENT,
      onBulkAction,
    );

    return () => {
      window.removeEventListener(
        PROJECTS_BULK_ACTION_EVENT,
        onBulkAction,
      );
    };
  }, [selectedIds]);

  useEffect(() => {
    if (!dialog) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDialog(null);
    }

    window.addEventListener("keydown", onKeyDown);
    (dialogChoiceRef.current ?? dialogConfirmRef.current)?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  useEffect(() => {
    if (!filterOpen && openRowMenu === null) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`.${styles.toolbarMenu}`) || target?.closest(`.${styles.rowMenuWrap}`)) return;
      setOpenRowMenu(null);
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [filterOpen, openRowMenu]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mobile = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobileFilters(mobile.matches);

    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);

  function toggleProject(projectId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function clearAllFilters() {
    setSearch("");
    setPersonFilter("all");
    setServiceFilter("all");
    setClientFilter("all");
    setActiveTab("all");
    setUnansweredOnly(false);
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) filteredProjects.forEach((project) => next.delete(project.id));
      else filteredProjects.forEach((project) => next.add(project.id));
      return next;
    });
  }

  async function runDialogAction() {
    if (!dialog) return;
    const choice = dialogChoiceRef.current?.value ?? "";

    setBusy(true);
    let outcome: ProjectBulkResult;
    try {
      if (dialog.kind === "status") {
        outcome = await bulkChangeProjectStatusAction(dialog.ids, choice);
      } else if (dialog.kind === "assign") {
        outcome = await bulkAssignProjectsAction(dialog.ids, choice ? choice : null);
      } else {
        outcome = await bulkArchiveProjectsAction(dialog.ids);
      }
    } catch {
      outcome = failedProjectBatch(dialog.ids, "The request could not be completed.");
    }
    setBusy(false);
    setDialog(null);
    setResult(outcome);

    if (outcome.succeeded.length > 0) {
      const done = new Set(outcome.succeeded.map((entry) => entry.id));
      setSelected((current) => new Set(Array.from(current).filter((id) => !done.has(id))));
      router.refresh();
    }
  }

  return (
    <section className={styles.workspace}>
      {!complete ? (
        <div className={styles.truncationNotice} role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            This view is showing only part of your orders, so the tab counts below are incomplete. Narrow the
            filters or contact an administrator.
          </span>
        </div>
      ) : null}

      {unknownResponseCount > 0 ? (
        <p className={styles.notice} role="status">
          Unanswered status is unavailable for {unknownResponseCount === rows.length ? "these orders" : "some orders"}. Those orders remain visible in All.
        </p>
      ) : null}

      {responseStatesAvailable ? <div className={styles.attentionStrip}>
        <div>
          <BellRing size={15} aria-hidden="true" />
          <strong>{unansweredCount}</strong>
          <span>{unansweredCount === 1 ? "unanswered order." : "unanswered orders."}</span>
        </div>

        <button
          type="button"
          aria-pressed={scopeCriteria.unansweredOnly}
          onClick={() => {
            setUnansweredOnly((current) => !current);
            setActiveTab("all");
          }}
        >
          {scopeCriteria.unansweredOnly ? "Show all" : "View"}
        </button>
      </div> : null}

      {result ? (
        <div className={styles.resultPanel} role="status" aria-live="polite">
          <div className={styles.resultHeading}>
            <span>{describeProjectBulkResult(result)}</span>
            <button type="button" onClick={() => setResult(null)}>
              Dismiss
            </button>
          </div>

          {result.attempted > 1 ? (
            <p className={styles.resultNote}>
              Projects are updated one at a time. Each result below is reported separately.
            </p>
          ) : null}

          {result.succeeded.length > 0 ? (
            <ul className={styles.resultList}>
              {result.succeeded.map((entry) => (
                <li className={styles.resultOk} key={`ok-${entry.id}`}>
                  <Check size={11} strokeWidth={3} aria-hidden="true" />
                  {entry.label}
                </li>
              ))}
            </ul>
          ) : null}

          {result.failed.length > 0 ? (
            <ul className={styles.resultList}>
              {result.failed.map((entry) => (
                <li className={styles.resultFail} key={`fail-${entry.id}`}>
                  <TriangleAlert size={11} aria-hidden="true" />
                  {entry.label}
                  <em>{entry.error}</em>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={styles.controlRow}>
        <div className={styles.statusTabs}>
          {TABS
            .filter((tab) =>
              ["Working\u2026", "pending_update", "waiting_reply", "all"].includes(tab.value),
            )
            .map((tab) => {
            const active = activeTab === tab.value;
            const count = counts[tab.value];

            return (
              <button
                key={tab.value}
                type="button"
                className={active ? styles.statusTabActive : styles.statusTab}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveTab(tab.value)}
              >
                <span className={styles.statusLabel}>
                  {tab.value === "pending_update"
                    ? "Pending Update"
                    : tab.value === "waiting_reply"
                      ? "Waiting Reply"
                      : tab.label}
                </span>
                {count > 0 ? <span className={styles.statusCount}>{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarMenu}>
            <button
              type="button"
              className={filterOpen ? styles.toolbarButtonActive : styles.toolbarButton}
              aria-expanded={filterOpen}
              aria-controls="projects-filter-panel"
              onClick={() => {
                setFilterOpen((current) => !current);
              }}
            >
              <Filter size={14} aria-hidden="true" />
              Filter
              {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
            </button>
          </div>

          <ProjectsHeaderActions capabilities={capabilities} />

        </div>
      </div>

      <div className={styles.mobileSearchRow}>
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={search}
          placeholder="Title, order number or client"
          autoComplete="off"
          aria-label="Search orders"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {filterOpen && !mobileFilters ? (
        <div className={styles.filterPanel} id="projects-filter-panel">
          <div>
            <label htmlFor="project-search">Search</label>
            <input
              id="project-search"
              type="search"
              value={search}
              placeholder="Title, order number or client"
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="project-person-filter">Person</label>
            <ProjectSimpleFilterPicker
              triggerId="project-person-filter"
              ariaLabel="Choose a person"
              triggerLabel={selectedPersonName}
              fixedOptions={[
                { id: "all", label: "Everyone", icon: <UserRound size={16} aria-hidden="true" /> },
                { id: "unassigned", label: "Unassigned", icon: <UserRound size={16} aria-hidden="true" /> },
              ]}
              options={personOptions}
              value={personFilter}
              onChange={setPersonFilter}
              searchPlaceholder="Search people..."
            />
          </div>

          <div>
            <label htmlFor="project-service-filter">Service</label>
            <ProjectServiceFilterPicker
              folders={serviceFolders}
              services={services}
              value={serviceFilter}
              onChange={setServiceFilter}
            />
          </div>

          <div>
            <label htmlFor="project-client-filter">Client</label>
            <ProjectSimpleFilterPicker
              triggerId="project-client-filter"
              ariaLabel="Choose a client"
              triggerLabel={selectedClientName}
              fixedOptions={[{ id: "all", label: "All clients", icon: <Building2 size={16} aria-hidden="true" /> }]}
              options={clientOptions}
              value={clientFilter}
              onChange={setClientFilter}
              searchPlaceholder="Search clients..."
            />
          </div>

          <div>
            <label htmlFor="project-status-filter">Status</label>
            <ProjectSimpleFilterPicker
              triggerId="project-status-filter"
              ariaLabel="Choose a status"
              triggerLabel={selectedStatusName}
              fixedOptions={[{ id: "all", label: "All statuses", icon: <ListChecks size={16} aria-hidden="true" /> }]}
              options={statusOptions}
              value={activeTab}
              onChange={(value) => setActiveTab(value as ProjectTab)}
              searchPlaceholder="Search statuses..."
            />
          </div>

          <button
            type="button"
            className={scopeCriteria.unansweredOnly ? styles.attentionFilterActive : styles.attentionFilter}
            aria-pressed={scopeCriteria.unansweredOnly}
            disabled={!responseStatesAvailable}
            onClick={() => setUnansweredOnly((current) => !current)}
          >
            <ListFilter size={14} aria-hidden="true" />
            Unanswered
          </button>

          <button type="button" className={styles.clearFilters} onClick={clearAllFilters}>
            Clear
          </button>
        </div>
      ) : null}

      <ProjectsFilterSheet
        open={filterOpen && mobileFilters}
        onClose={() => setFilterOpen(false)}
        people={viewerId ? [{ id: viewerId, name: "Assigned to me" }, ...people.filter((person) => person.id !== viewerId)] : people}
        clients={clients}
        serviceFolders={serviceFolders}
        services={services}
        personFilter={personFilter}
        onPersonFilterChange={setPersonFilter}
        clientFilter={clientFilter}
        onClientFilterChange={setClientFilter}
        serviceFilter={serviceFilter}
        onServiceFilterChange={setServiceFilter}
        statusFilter={activeTab}
        onStatusFilterChange={setActiveTab}
        unansweredOnly={scopeCriteria.unansweredOnly}
        responseStatesAvailable={responseStatesAvailable}
        onUnansweredOnlyChange={setUnansweredOnly}
        onClear={clearAllFilters}
        activeFilterCount={activeFilterCount}
      />

      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <button
            type="button"
            className={allVisibleSelected ? styles.checkboxActive : styles.checkbox}
            aria-label="Select all visible orders"
            aria-pressed={allVisibleSelected}
            disabled={filteredProjects.length === 0}
            onClick={toggleAllVisible}
          >
            {allVisibleSelected ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
          </button>

          <span>Client / Order</span>
          <span>People</span>
          <span>Status</span>
          <span>Created</span>
        </div>

        <div className={styles.projectRows}>
          {filteredProjects.map((project) => {
            const checked = selected.has(project.id);
            const clientName = project.companyName ?? "Unavailable client";

            return (
              <div
                className={project.status === "canceled" ? styles.projectRowCanceled : styles.projectRow}
                key={project.id}
              >
                <button
                  type="button"
                  className={checked ? styles.checkboxActive : styles.checkbox}
                  aria-label={`Select ${clientName} order ${project.title}`}
                  aria-pressed={checked}
                  onClick={() => toggleProject(project.id)}
                >
                  {checked ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
                </button>

                <Link className={styles.projectIdentity} href={`/orders/${project.id}`}>
                  <strong className={styles.clientName}>
                    <span className={styles.clientLabel}>{clientName}</span>
                    {project.unanswered === true ? <span className={styles.unansweredBadge}>Unanswered</span> : null}
                  </strong>
                  <span>{project.title}</span>
                  <small>{project.serviceName ?? "Unavailable service"}</small>
                </Link>

                <div className={styles.personCell}>
                  {project.assigneeName ? (
                    <>
                      <span className={styles.avatar}>{projectInitials(project.assigneeName)}</span>
                      <span>{project.assigneeName}</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.avatarEmpty} aria-hidden="true">
                        &mdash;
                      </span>
                      <span className={styles.unassigned}>Unassigned</span>
                    </>
                  )}
                </div>

                <div>
                  <span
                    className={`${styles.statusBadge} ${styles[`status_${project.status}` as keyof typeof styles]}`}
                  >
                    {projectStatusLabels[project.status]}
                  </span>
                </div>

                <span className={styles.created}>{project.createdLabel}</span>

              </div>
            );
          })}

          {filteredProjects.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{rows.length === 0 ? "No orders yet" : "No orders match this view"}</strong>
              <span>
                {rows.length === 0
                  ? "Orders you create will appear here."
                  : "Change the status or filters to see more."}
              </span>
            </div>
          ) : null}
        </div>

        <div className={styles.tableFooter}>
          <span>
            {filteredProjects.length} {filteredProjects.length === 1 ? "order" : "orders"}
          </span>
          <span>{selected.size} selected</span>
        </div>
      </div>

      {dialog ? (
        <div className={styles.dialogBackdrop} onMouseDown={() => (busy ? undefined : setDialog(null))}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-dialog-title"
            ref={dialogRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="project-dialog-title">{dialogTitles[dialog.kind]}</h2>

            <p>
              {dialog.ids.length === 1
                ? "This applies to 1 order."
                : `This applies to ${dialog.ids.length} orders, one at a time. Some may succeed while others fail.`}
            </p>

            {dialog.kind === "status" ? (
              <label htmlFor="project-dialog-status">
                New status
                <select id="project-dialog-status" ref={dialogChoiceRef} defaultValue="Working\u2026">
                  {orderStatuses.map((status) => (
                    <option key={status} value={status}>
                      {projectStatusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {dialog.kind === "assign" ? (
              <label htmlFor="project-dialog-assignee">
                Assign to
                <select id="project-dialog-assignee" ref={dialogChoiceRef} defaultValue="">
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {dialog.kind === "archive" ? (
              <p>Archived orders leave the active list. They are never deleted.</p>
            ) : null}

            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancel}
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className={styles.dialogConfirm}
                aria-busy={busy || undefined}
                disabled={busy}
                ref={dialogConfirmRef}
                onClick={runDialogAction}
              >
                {busy ? "Working\u2026" : dialog.kind === "archive" ? "Archive" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
