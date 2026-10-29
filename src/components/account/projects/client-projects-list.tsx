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

const filters: { value: "all" | OrderStatus; label: string }[] = [
  { value: "all", label: "All projects" },
  { value: "pending", label: "Pending" },
  { value: "submitted", label: "Getting started" },
  { value: "working", label: "Wolf Forge working" },
  { value: "waiting_reply", label: "Waiting for reply" },
  { value: "pending_update", label: "Needs information" },
  { value: "complete", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

function ProjectRow({ project }: { project: ClientProjectView }) {
  const attention = projectAttention(project.status);
  return <li><Link href={`/account/projects/${project.id}`} className="portal-work-row">
    <span className="portal-work-main">
      <span className="portal-project-ref">{project.reference}</span>
      <strong>{project.title}</strong>
      <span>{project.serviceName ?? "Wolf Forge project"}{project.startedLabel ? ` · Started ${project.startedLabel}` : ""}{project.dueLabel ? ` · Due ${project.dueLabel}` : ""}</span>
    </span>
    <span className="portal-work-meta">
      <AttentionPill tone={attention.tone} label={filters.find((filter) => filter.value === project.status)!.label} />
      <PortalProgressBar percent={project.progress.percent} label={project.progress.total === 0 ? null : `${project.progress.completed} of ${project.progress.total} steps complete`} />
    </span>
    <ArrowRight aria-hidden={true} />
  </Link></li>;
}

export function ClientProjectsList({ projects }: { projects: ClientProjectView[] }) {
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const open = projects.filter((project) => clientProjectIsOpen(project.status));
  const blocked = open.filter((project) => projectAttention(project.status).tone === "waiting_on_you");
  const ordered = [...blocked, ...open.filter((project) => !blocked.includes(project)), ...projects.filter((project) => !clientProjectIsOpen(project.status))];
  const visible = ordered.filter((project) => filter === "all" || project.status === filter);
  const selectedLabel = filters.find((option) => option.value === filter)!.label;
  const groups = filter === "all" ? [
    { title: "In progress", projects: visible.filter((project) => clientProjectIsOpen(project.status)) },
    { title: "Completed", projects: visible.filter((project) => project.status === "complete") },
    { title: "Canceled", projects: visible.filter((project) => project.status === "canceled") },
  ] : [{ title: selectedLabel, projects: visible }];

  return <div className="portal-page">
    <header className="portal-page-head"><h1>Projects</h1><p>{projects.length === 0 ? "Your projects will appear here once work is underway." : blocked.length > 0 ? `${blocked.length} ${blocked.length === 1 ? "project needs" : "projects need"} information from you.` : `${open.length} in progress of ${projects.length} total.`}</p></header>
    <div className={styles.filterBlock}>
      <div className={styles.filters} role="group" aria-label="Filter projects by status">
      {filters.map((option) => {
        const count = option.value === "all" ? projects.length : projects.filter((project) => project.status === option.value).length;
        return <button key={option.value} type="button" aria-pressed={filter === option.value}
          aria-label={`${option.label}, ${count} ${count === 1 ? "project" : "projects"}`}
          onClick={() => setFilter(option.value)}>
          {option.label}<span aria-hidden="true">{count}</span>
        </button>;
      })}
      </div>
      <p className={styles.summary} role="status" aria-live="polite" aria-atomic="true">
        {filter === "all" ? `Showing all ${visible.length} projects.` : `${visible.length} ${visible.length === 1 ? "project" : "projects"} · ${selectedLabel}`}
      </p>
    </div>
    {visible.length === 0 ? <p className="portal-empty">{projects.length === 0 ? "Nothing here yet. Your projects and their progress will appear here." : `No projects are currently marked “${selectedLabel}”. Choose another status to keep browsing.`}</p> : groups.filter((group) => group.projects.length > 0).map((group) =>
      <section className="portal-section" key={group.title} aria-label={group.title}>
        <header className="portal-section-head"><h2>{group.title}</h2></header>
        <ul className="portal-work-list">{group.projects.map((project) => <ProjectRow key={project.id} project={project} />)}</ul>
      </section>)}
  </div>;
}
