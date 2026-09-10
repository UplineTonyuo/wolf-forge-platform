"use client";

import { FileText, KeyRound, SquarePlay } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  youtubeOperationStatusLabels,
  youtubeOperationStatuses,
  type YoutubeOperationItem,
  type YoutubeOperationStatus,
  type YoutubeWorkflowStage,
} from "../../domain/operations/youtube-seo-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { OperationsWorkflowMonthOption } from "../../lib/integrations/operations-google-sheets";
import { AnimatedSelect, type AnimatedSelectOption } from "../ui/animated-select";
import { DepartmentConnectionState } from "./department-connection-state";
import { DepartmentOutputs } from "./department-outputs";
import { DepartmentRecordInspector, type DepartmentInspectorTab } from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

export type YoutubeSeoWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: YoutubeSeoWorkflowViewState;
  items: YoutubeOperationItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
  monthOptions?: OperationsWorkflowMonthOption[];
  selectedMonth?: string | null;
};

type StatusFilter = "all" | YoutubeOperationStatus;

const STATUS_TONE: Record<YoutubeOperationStatus, WorkflowStatusTone> = {
  not_started: "neutral",
  in_progress: "info",
  stuck: "warning",
  paused: "neutral",
  cancelled: "neutral",
  completed: "positive",
};

export function YoutubeSeoWorkflowView({ state, items, sourceTab, lastSyncedAt, monthOptions = [], selectedMonth = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [vaFilter, setVaFilter] = useState("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lastSourceTab, setLastSourceTab] = useState(sourceTab);

  if (lastSourceTab !== sourceTab) {
    setLastSourceTab(sourceTab);
    setSearch("");
    setStatusFilter("all");
    setVaFilter("all");
    setPackageFilter("all");
    setSelectedItemId(null);
  }

  const vaOptions = useMemo(() => distinctSorted(items, (item) => item.assignedVa), [items]);
  const hasCredibleVaData = vaOptions.length > 0;
  const packageOptions = useMemo(() => distinctSorted(items, (item) => item.seoPackage), [items]);
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries([["all", items.length], ...youtubeOperationStatuses.map((status) => [status, 0])]) as Record<StatusFilter, number>;
    for (const item of items) counts[item.normalizedStatus] += 1;
    return counts;
  }, [items]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.normalizedStatus !== statusFilter) return false;
      if (vaFilter !== "all" && item.assignedVa !== vaFilter) return false;
      if (packageFilter !== "all" && item.seoPackage !== packageFilter) return false;
      if (!needle) return true;
      return [
        item.client,
        item.city,
        item.primaryKeyword,
        item.orderNumber,
        item.seoPackage,
        item.assignedVa,
        item.sourceSection,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [items, packageFilter, search, statusFilter, vaFilter]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || vaFilter !== "all" || packageFilter !== "all";
  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: statusCounts.all },
    ...youtubeOperationStatuses.map((status) => ({
      value: status,
      label: youtubeOperationStatusLabels[status],
      count: statusCounts[status],
    })),
  ];
  const columns: DepartmentWorkColumn<YoutubeOperationItem>[] = [
    { key: "client", header: "Client", width: hasCredibleVaData ? "22%" : "26%", render: clientLabel, title: (item) => item.client },
    { key: "package", header: "Package", width: "18%", hideOnTablet: true, render: (item) => item.seoPackage ?? "—", title: (item) => item.seoPackage ?? undefined },
    ...(hasCredibleVaData ? [{ key: "assigned", header: "Assigned", width: "12%", hideOnTablet: true, render: (item: YoutubeOperationItem) => item.assignedVa ?? "—" }] : []),
    { key: "wave", header: "Wave Videos", width: "14%", render: (item) => <YoutubeStatus status={item.waveStage.state} /> },
    { key: "youtube", header: "YouTube", width: "14%", render: (item) => <YoutubeStatus status={item.youtubeStage.state} /> },
    { key: "status", header: "Status", width: "14%", render: (item) => <YoutubeStatus status={item.normalizedStatus} /> },
    { key: "outputs", header: "Outputs", width: "13%", render: (item) => <DepartmentOutputs resources={stages(item)} /> },
  ];

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setVaFilter("all");
    setPackageFilter("all");
  }

  function changeMonth(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="dept-workflow">
      <DepartmentWorkflowHeader title="YouTube SEO" count={state === "ready" ? items.length : undefined} countLabel="clients" />
      {state === "unconfigured" ? <DepartmentConnectionState departmentName="YouTube SEO" headingId="youtube-seo-connection-title" icon={<SquarePlay aria-hidden="true" size={15} strokeWidth={1.8} />} /> : null}
      {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>YouTube SEO workflow is temporarily unavailable.</strong><p>The workflow could not be refreshed right now. Try again shortly.</p></div> : null}
      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search clients, cities, keywords…"
            searchAriaLabel="Search YouTube SEO work"
            selects={hasCredibleVaData ? [{ allLabel: "All VAs", ariaLabel: "Filter by assigned VA", value: vaFilter, options: vaOptions, onChange: setVaFilter, size: "compact" as const }] : []}
            secondaryFilters={packageOptions.length > 0 ? [{ key: "package", label: "Package", allLabel: "All Packages", ariaLabel: "Filter by SEO package", value: packageFilter, options: packageOptions, onChange: setPackageFilter }] : []}
            trailingSelects={[
              { allLabel: "All Statuses", ariaLabel: "Filter by status", value: statusFilter, options: [], onChange: (value) => setStatusFilter(value as StatusFilter), countedOptions: statusSelectOptions },
            ]}
            trailingControl={monthOptions.length > 0 ? <AnimatedSelect name="youtube-seo-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} onChange={changeMonth} options={monthOptions.map((option) => ({ value: option.value, label: option.label }))} /> : null}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
          <div key={`${sourceTab}|${vaFilter}|${packageFilter}`} className="dept-filter-results">
            {visibleItems.length === 0 ? <p className="dept-empty">{items.length === 0 && !hasActiveFilters ? "No YouTube SEO workflow records were found." : "No YouTube SEO work matches these filters."}</p> : (
              <>
                <DepartmentWorkTable columns={columns} rows={visibleItems} selectedRowId={selectedItemId} onSelectRow={(item) => setSelectedItemId(item.id)} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
                <DepartmentWorkListMobile
                  rows={visibleItems}
                  onSelectRow={(item) => setSelectedItemId(item.id)}
                  renderTitle={clientLabel}
                  renderStatus={(item) => <YoutubeStatus status={item.normalizedStatus} />}
                  renderDetailLine={(item) => item.seoPackage ?? item.sourceSection}
                  renderMetaLeft={(item) => `Wave: ${youtubeOperationStatusLabels[item.waveStage.state]}`}
                  renderMetaRight={(item) => `YouTube: ${youtubeOperationStatusLabels[item.youtubeStage.state]}`}
                  renderAction={(item) => <DepartmentOutputs resources={stages(item)} />}
                  getRowLabel={(item) => `Open ${clientLabel(item)}`}
                />
              </>
            )}
          </div>
        </>
      ) : null}
      <DepartmentRecordInspector open={selectedItem !== null} header={selectedItem ? <InspectorHeader item={selectedItem} /> : null} tabs={selectedItem ? inspectorTabs(selectedItem, sourceTab, lastSyncedAt) : []} onClose={() => setSelectedItemId(null)} />
    </div>
  );
}

function stages(item: YoutubeOperationItem): YoutubeWorkflowStage[] {
  return [item.waveStage, item.youtubeStage];
}

function YoutubeStatus({ status }: { status: YoutubeOperationStatus }) {
  return <WorkflowStatus label={youtubeOperationStatusLabels[status]} tone={STATUS_TONE[status]} />;
}

function clientLabel(item: YoutubeOperationItem): string {
  if (!item.clientUrl) return item.client;
  const prefix = item.client.slice(0, item.client.indexOf(item.clientUrl)).replace(/[\s-]+$/, "").trim();
  return prefix || formatCleanDomain(item.clientUrl);
}

function InspectorHeader({ item }: { item: YoutubeOperationItem }) {
  return <div className="dept-inspector-identity"><strong>{clientLabel(item)}</strong><YoutubeStatus status={item.normalizedStatus} />{item.clientUrl ? <DepartmentResourceLink href={item.clientUrl} label="Open website" /> : null}</div>;
}

function inspectorTabs(item: YoutubeOperationItem, sourceTab: string | null, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const overviewFields = [
    { label: "Package", value: item.seoPackage },
    { label: "Assigned VA", value: item.assignedVa },
    { label: "Order #", value: item.orderNumber },
    { label: "Primary keyword", value: item.primaryKeyword },
    { label: "City", value: item.city },
    { label: "Email", value: item.email },
  ].filter((field): field is { label: string; value: string } => field.value !== null);
  const resources = [
    ...(item.clientUrl ? [{ label: "Website", href: item.clientUrl }] : []),
    ...(item.loginUrl ? [{ label: "Login", href: item.loginUrl }] : []),
    ...(item.promptSopUrl ? [{ label: "Prompt / SOP", href: item.promptSopUrl }] : []),
    ...stages(item).filter((stage) => stage.outputUrl).map((stage) => ({ label: stage.label, href: stage.outputUrl! })),
  ];
  const workflowSections = [
    { content: <div className="onpage-deliverables">{stages(item).map((stage) => <StageRow key={stage.key} stage={stage} />)}</div> },
    ...(item.notes ? [{ title: "Notes / blockers", fields: [{ label: "Source note", value: item.notes }] }] : []),
  ];

  return [
    { id: "overview", label: "Overview", sections: [{ fields: overviewFields.length > 0 ? overviewFields : [{ label: "Details", value: "No additional overview fields recorded." }] }] },
    { id: "workflow", label: "Workflow", sections: workflowSections },
    { id: "resources", label: "Resources", sections: [{ content: resources.length > 0 ? <div className="dept-resource-list">{resources.map((resource) => <div key={`${resource.label}-${resource.href}`} className="dept-resource-row"><span>{resource.label}</span><DepartmentResourceLink href={resource.href} label="Open" icon={resource.label === "Login" ? <KeyRound aria-hidden="true" size={13} /> : <FileText aria-hidden="true" size={13} />} /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: sourceTab ?? item.sourceTab },
      { label: "Section", value: item.sourceSection },
      { label: "Access", value: "Read only" },
      { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}

function StageRow({ stage }: { stage: YoutubeWorkflowStage }) {
  return <div className="onpage-deliverable-row"><div><strong>{stage.label}</strong>{stage.output && !stage.outputUrl ? <span>{stage.output}</span> : null}</div><div className="onpage-deliverable-action"><YoutubeStatus status={stage.state} />{stage.outputUrl ? <DepartmentResourceLink href={stage.outputUrl} label="Open" /> : null}</div></div>;
}

function distinctSorted(items: readonly YoutubeOperationItem[], pick: (item: YoutubeOperationItem) => string | null): string[] {
  return [...new Set(items.map(pick).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}
