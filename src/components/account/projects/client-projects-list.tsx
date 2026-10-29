"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { projectAttention } from "../../../domain/client-portal/attention";
import { clientProjectIsOpen, type ClientProjectView } from "../../../domain/orders/client-projections";
import type { OrderStatus } from "../../../domain/orders/schema";
import { AttentionPill } from "../ui/attention-pill";
import { PortalProgressBar } from "../ui/portal-progress-bar";
import styles from "./client-projects-list.module.css";

const filters = [
  { value: "pending", label: "Pending" },
  { value: "working", label: "Working" },
  { value: "complete", label: "Complete" },
  { value: "canceled", label: "Canceled" },
  { value: "waiting_reply", label: "Waiting reply" },
  { value: "all", label: "All" },
] as const;
type ProjectFilter = (typeof filters)[number]["value"];
function matches(status: OrderStatus, filter: ProjectFilter) {
  return filter === "all" || (filter === "pending" ? ["pending", "submitted", "pending_update"].includes(status) : status === filter);
}

function ProjectRow({ project, intakeHref }: { project: ClientProjectView; intakeHref?: string }) {
  const attention = projectAttention(project.status);
  return <li><Link href={intakeHref ?? `/account/projects/${project.id}`} className="portal-work-row">
    <span className="portal-work-main">
      <span className="portal-project-ref">{project.reference}</span>
      <strong>{project.title}</strong>
      <span>{project.serviceName ?? "Wolf Forge project"}{project.startedLabel ? ` · Started ${project.startedLabel}` : ""}{project.dueLabel ? ` · Due ${project.dueLabel}` : ""}</span>
    </span>
    <span className="portal-work-meta">
      {intakeHref ? <span className={styles.intakeAction}>Complete intake form</span> : <AttentionPill tone={attention.tone} label={project.statusLabel} />}
      {project.progress.total > 0 ? <PortalProgressBar percent={project.progress.percent} label={`${project.progress.completed} of ${project.progress.total} steps complete`} /> : null}
    </span>
    <ArrowRight aria-hidden={true} />
  </Link></li>;
}

export function ClientProjectsList({ projects, intakeLinks = {} }: { projects: ClientProjectView[]; intakeLinks?: Record<string, string> }) {
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [page, setPage] = useState(1);
  const open = projects.filter((project) => clientProjectIsOpen(project.status));
  const blocked = open.filter((project) => projectAttention(project.status).tone === "waiting_on_you");
  const ordered = [...blocked, ...open.filter((project) => !blocked.includes(project)), ...projects.filter((project) => !clientProjectIsOpen(project.status))];
  const visible = ordered.filter((project) => matches(project.status, filter));
  const pageCount = Math.max(1, Math.ceil(visible.length / 5));
  const currentPage = Math.min(page, pageCount);
  const pageProjects = visible.slice((currentPage - 1) * 5, currentPage * 5);
  const selectedLabel = filters.find((option) => option.value === filter)!.label;
  const groups = filter === "all" ? [
    { title: "In progress", projects: pageProjects.filter((project) => clientProjectIsOpen(project.status)) },
    { title: "Completed", projects: pageProjects.filter((project) => project.status === "complete") },
    { title: "Canceled", projects: pageProjects.filter((project) => project.status === "canceled") },
  ] : [{ title: selectedLabel, projects: pageProjects }];

  return <div className="portal-page">
    <header className="portal-page-head"><h1>Projects</h1><p>{projects.length === 0 ? "Your projects will appear here once work is underway." : blocked.length > 0 ? `${blocked.length} ${blocked.length === 1 ? "project needs" : "projects need"} information from you.` : `${open.length} in progress of ${projects.length} total.`}</p></header>
    <div className={styles.filterBlock}>
      <div className={styles.filters} role="group" aria-label="Filter projects by status">
      {filters.map((option) => {
        const count = projects.filter((project) => matches(project.status, option.value)).length;
        return <button key={option.value} type="button" aria-pressed={filter === option.value}
          aria-label={`${option.label}, ${count} ${count === 1 ? "project" : "projects"}`}
          onClick={() => { setFilter(option.value); setPage(1); }}>
          {option.label}<span aria-hidden="true">{count}</span>
        </button>;
      })}
      </div>
      <p className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        {visible.length ? `${(currentPage - 1) * 5 + 1}–${Math.min(currentPage * 5, visible.length)} of ${visible.length} projects` : "No matching projects"}
      </p>
    </div>
    {visible.length === 0 ? <p className="portal-empty">{projects.length === 0 ? "Nothing here yet. Your projects and their progress will appear here." : `No projects are currently marked “${selectedLabel}”. Choose another status to keep browsing.`}</p> : groups.filter((group) => group.projects.length > 0).map((group) =>
      <section className="portal-section" key={group.title} aria-label={group.title}>
        <header className="portal-section-head"><h2>{group.title}</h2></header>
        <ul className="portal-work-list">{group.projects.map((project) => <ProjectRow key={project.id} project={project} intakeHref={matches(project.status, "pending") ? intakeLinks[project.id] : undefined} />)}</ul>
      </section>)}
    {pageCount > 1 ? <nav className={styles.pagination} aria-label="Project pages">
      <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage} of {pageCount}</span>
      <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
    </nav> : null}
  </div>;
}
