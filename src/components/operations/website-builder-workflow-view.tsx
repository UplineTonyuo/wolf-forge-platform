"use client";

import { FileText, Globe, LayoutTemplate } from "lucide-react";
import { useMemo, useState } from "react";
import {
  WEBSITE_BUILDER_KNOWN_STATUS_ORDER,
  type WebsiteBuilderProject,
  type WebsiteBuilderStatusKey,
} from "../../domain/operations/website-builder-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { AnimatedSelectOption } from "../ui/animated-select";
import { DepartmentConnectionState } from "./department-connection-state";
import { DepartmentOutputs, type DepartmentOutputResource } from "./department-outputs";
import { DepartmentRecordInspector, type DepartmentInspectorTab } from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

export type WebsiteBuilderWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: WebsiteBuilderWorkflowViewState;
  projects: WebsiteBuilderProject[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
};

type StatusFilter = "all" | string;

const KNOWN_STATUS_TONE: Partial<Record<WebsiteBuilderStatusKey, WorkflowStatusTone>> = {
  completed: "positive",
  in_progress: "info",
  waiting_for_domain: "warning",
  waiting_for_license: "warning",
  waiting_edits: "warning",
  backlog: "neutral",
  not_started: "neutral",
  other: "neutral",
};

export function WebsiteBuilderWorkflowView({ state, projects, sourceTab, lastSyncedAt }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [executiveFilter, setExecutiveFilter] = useState("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const executiveOptions = useMemo(() => distinctSorted(projects, (project) => project.executive), [projects]);
  const hasCredibleExecutiveData = executiveOptions.length > 0;

  const statusOptions = useMemo(() => buildStatusOptions(projects), [projects]);

  const visibleProjects = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (statusFilter !== "all" && project.status.label !== statusFilter) return false;
      if (executiveFilter !== "all" && project.executive !== executiveFilter) return false;
      if (!needle) return true;
      return [
        project.business,
        project.orderNumber,
        project.executive,
        project.status.label,
        project.bottleneck,
        project.actions,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [projects, statusFilter, executiveFilter, search]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || executiveFilter !== "all";

  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: projects.length },
    ...statusOptions.map((option) => ({ value: option.label, label: option.label, count: option.count })),
  ];

  const columns: DepartmentWorkColumn<WebsiteBuilderProject>[] = [
    { key: "business", header: "Business", width: hasCredibleExecutiveData ? "20%" : "24%", render: businessLabel, title: (project) => project.business },
    ...(hasCredibleExecutiveData ? [{ key: "executive", header: "Executive", width: "10%", hideOnTablet: true, render: (project: WebsiteBuilderProject) => project.executive ?? "—" }] : []),
    { key: "onboarded", header: "Onboarded", width: "10%", hideOnTablet: true, render: (project: WebsiteBuilderProject) => project.dateOnboarded ?? "—" },
    { key: "eta", header: "ETA", width: "9%", hideOnTablet: true, render: (project: WebsiteBuilderProject) => project.eta ?? "—" },
    { key: "domain", header: "Domain", width: "15%", render: (project: WebsiteBuilderProject) => project.domain ? formatCleanDomain(project.domain) : "—", title: (project) => project.domain ?? undefined },
    { key: "status", header: "Status", width: "13%", render: (project: WebsiteBuilderProject) => <ProjectStatus status={project.status} /> },
    { key: "bottleneck", header: "Bottleneck", width: "22%", render: (project: WebsiteBuilderProject) => <BottleneckCell text={project.bottleneck} />, title: (project) => project.bottleneck ?? undefined },
    { key: "resources", header: "Resources", width: "14%", render: (project: WebsiteBuilderProject) => <DepartmentOutputs resources={projectResources(project)} noun="resource" /> },
  ];

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setExecutiveFilter("all");
  }

  return (
    <div className="dept-workflow">
      <DepartmentWorkflowHeader title="Website Builder" />
      {state === "unconfigured" ? <DepartmentConnectionState departmentName="Website Builder" headingId="website-builder-connection-title" icon={<LayoutTemplate aria-hidden="true" size={15} strokeWidth={1.8} />} /> : null}
      {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>Website Builder workflow is temporarily unavailable.</strong><p>The workflow could not be refreshed right now. Try again shortly.</p></div> : null}
      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search businesses, order #, bottlenecks…"
            searchAriaLabel="Search Website Builder work"
            selects={hasCredibleExecutiveData ? [{ allLabel: "All Executives", ariaLabel: "Filter by executive", value: executiveFilter, options: executiveOptions, onChange: setExecutiveFilter, size: "compact" }] : []}
            trailingSelects={[
              {
                allLabel: "All Statuses",
                ariaLabel: "Filter by status",
                value: statusFilter,
                options: [],
                onChange: setStatusFilter,
                countedOptions: statusSelectOptions,
              },
            ]}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
          <div key={executiveFilter} className="dept-filter-results">
            {visibleProjects.length === 0 ? <p className="dept-empty">{projects.length === 0 && !hasActiveFilters ? "No Website Builder workflow records were found." : "No Website Builder work matches these filters."}</p> : (
              <>
                <DepartmentWorkTable columns={columns} rows={visibleProjects} selectedRowId={selectedProjectId} onSelectRow={(project) => setSelectedProjectId(project.id)} getRowLabel={(project) => `Open ${businessLabel(project)}`} />
                <DepartmentWorkListMobile
                  rows={visibleProjects}
                  onSelectRow={(project) => setSelectedProjectId(project.id)}
                  renderTitle={businessLabel}
                  renderStatus={(project) => <ProjectStatus status={project.status} />}
                  renderDetailLine={(project) => project.bottleneck ?? "No bottleneck recorded"}
                  renderMetaLeft={(project) => project.eta ? `ETA: ${project.eta}` : "ETA: —"}
                  renderMetaRight={(project) => project.executive ?? "Unassigned"}
                  renderAction={(project) => <DepartmentOutputs resources={projectResources(project)} noun="resource" />}
                  getRowLabel={(project) => `Open ${businessLabel(project)}`}
                />
              </>
            )}
          </div>
        </>
      ) : null}
      <DepartmentRecordInspector open={selectedProject !== null} header={selectedProject ? <InspectorHeader project={selectedProject} /> : null} tabs={selectedProject ? inspectorTabs(selectedProject, sourceTab, lastSyncedAt) : []} onClose={() => setSelectedProjectId(null)} />
    </div>
  );
}

function projectResources(project: WebsiteBuilderProject): DepartmentOutputResource[] {
  return [
    { key: "ob", label: "Onboarding Sheet", outputUrl: project.obUrl },
    { key: "webContent", label: "Web Content", outputUrl: project.webContentUrl },
    { key: "domain", label: "Domain", outputUrl: project.domainUrl },
  ];
}

function buildStatusOptions(projects: readonly WebsiteBuilderProject[]): { key: WebsiteBuilderStatusKey; label: string; count: number }[] {
  const counts = new Map<string, { key: WebsiteBuilderStatusKey; label: string; count: number }>();
  for (const project of projects) {
    const existing = counts.get(project.status.label);
    if (existing) existing.count += 1;
    else counts.set(project.status.label, { key: project.status.key, label: project.status.label, count: 1 });
  }
  const byLabel = [...counts.values()];
  const knownOrdered = WEBSITE_BUILDER_KNOWN_STATUS_ORDER
    .map((key) => byLabel.find((entry) => entry.key === key))
    .filter((value): value is { key: WebsiteBuilderStatusKey; label: string; count: number } => Boolean(value));
  const other = byLabel.filter((entry) => entry.key === "other").sort((left, right) => left.label.localeCompare(right.label));
  return [...knownOrdered, ...other];
}

function ProjectStatus({ status }: { status: WebsiteBuilderProject["status"] }) {
  return <WorkflowStatus label={status.label} tone={KNOWN_STATUS_TONE[status.key] ?? "neutral"} />;
}

/** Clamps free-text bottleneck source wording to one line in the main table; the full, untouched text stays available via the cell's native `title` and in the inspector. */
function BottleneckCell({ text }: { text: string | null }) {
  if (!text) return <>—</>;
  return (
    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function businessLabel(project: WebsiteBuilderProject): string {
  if (!project.businessUrl) return project.business;
  const prefix = project.business.slice(0, project.business.indexOf(project.businessUrl)).replace(/[\s-]+$/, "").trim();
  return prefix || formatCleanDomain(project.businessUrl);
}

function InspectorHeader({ project }: { project: WebsiteBuilderProject }) {
  return <div className="dept-inspector-identity"><strong>{businessLabel(project)}</strong><ProjectStatus status={project.status} />{project.domainUrl ? <DepartmentResourceLink href={project.domainUrl} label="Open site" icon={<Globe aria-hidden="true" size={13} />} /> : null}</div>;
}

function inspectorTabs(project: WebsiteBuilderProject, sourceTab: string | null, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const overviewFields = [
    { label: "Business", value: project.business },
    { label: "Executive", value: project.executive },
    { label: "SEO Order #", value: project.orderNumber },
    { label: "Date Onboarded", value: project.dateOnboarded },
    { label: "ETA", value: project.eta },
    { label: "Status", value: project.status.label },
  ].filter((field): field is { label: string; value: string } => field.value !== null);

  const deliveryFields = [
    { label: "Onboarding Sheet", value: project.ob },
    { label: "Web Content", value: project.webContent },
    { label: "Domain", value: project.domain },
    { label: "Bottleneck", value: project.bottleneck },
    { label: "Actions", value: project.actions },
  ].filter((field): field is { label: string; value: string } => field.value !== null);

  const resources = [
    ...(project.obUrl ? [{ label: "Onboarding Sheet", href: project.obUrl, icon: <FileText aria-hidden="true" size={13} /> }] : []),
    ...(project.webContentUrl ? [{ label: "Web Content", href: project.webContentUrl, icon: <FileText aria-hidden="true" size={13} /> }] : []),
    ...(project.domainUrl ? [{ label: "Domain", href: project.domainUrl, icon: <Globe aria-hidden="true" size={13} /> }] : []),
  ];

  return [
    { id: "overview", label: "Overview", sections: [{ fields: overviewFields.length > 0 ? overviewFields : [{ label: "Details", value: "No additional overview fields recorded." }] }] },
    { id: "delivery", label: "Delivery", sections: [{ fields: deliveryFields.length > 0 ? deliveryFields : [{ label: "Details", value: "No delivery fields recorded." }] }] },
    { id: "resources", label: "Resources", sections: [{ content: resources.length > 0 ? <div className="dept-resource-list">{resources.map((resource) => <div key={resource.label} className="dept-resource-row"><span>{resource.label}</span><DepartmentResourceLink href={resource.href} label="Open" icon={resource.icon} /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: sourceTab ?? project.sourceTab },
      { label: "Section", value: project.sourceSection },
      { label: "Access", value: "Read only" },
      { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}

function distinctSorted(projects: readonly WebsiteBuilderProject[], pick: (project: WebsiteBuilderProject) => string | null): string[] {
  return [...new Set(projects.map(pick).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}
