"use client";

import { FileText, KeyRound, MapPinned } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  gmbOperationStatusLabels,
  gmbOperationStatuses,
  type GmbOperationItem,
  type GmbOperationStatus,
  type GmbWorkflowStage,
} from "../../domain/operations/gmb-management-workflow";
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

export type GmbManagementWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: GmbManagementWorkflowViewState;
  items: GmbOperationItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
  monthOptions?: OperationsWorkflowMonthOption[];
  selectedMonth?: string | null;
};

type StatusFilter = "all" | GmbOperationStatus;

const STATUS_TONE: Record<GmbOperationStatus, WorkflowStatusTone> = {
  not_started: "neutral",
  in_progress: "info",
  stuck: "warning",
  paused: "neutral",
  cancelled: "neutral",
  completed: "positive",
};

/** Single-line ellipsis for the free-text table columns (Client, Package) — real source values run up to
 * ~57 characters ("VIS Mountain Marketing & Advertising (Downers Grove, IL)") or ~55 ("Platinum SEO Success
 * Blueprint (100 Targeted Keywords)"); without this, a `<td>`'s default text wrapping grows that one row
 * taller than its neighbors instead of overflowing sideways. */
function ClampText({ value }: { value: string }) {
  return <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>;
}

/** Compact, source-honest blocker/note preview for the table — real notes are rare (a handful of rows per
 * month) but operationally important ("can't post, need to verify GMB"), so this clamps to one line rather
 * than growing the row; the full text stays reachable via `title` here and unclamped in the inspector's own
 * Notes / Blockers tab. */
function NoteCell({ item }: { item: GmbOperationItem }) {
  if (!item.notes) return <>—</>;
  return (
    <span title={item.notes} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {item.notes}
    </span>
  );
}

export function GmbManagementWorkflowView({ state, items, sourceTab, lastSyncedAt, monthOptions = [], selectedMonth = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lastSourceTab, setLastSourceTab] = useState(sourceTab);

  if (lastSourceTab !== sourceTab) {
    setLastSourceTab(sourceTab);
    setSearch("");
    setStatusFilter("all");
    setPackageFilter("all");
    setSelectedItemId(null);
  }

  const packageOptions = useMemo(() => distinctSorted(items, (item) => item.seoPackage), [items]);
  const hasNotes = items.some((item) => item.notes);
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries([["all", items.length], ...gmbOperationStatuses.map((status) => [status, 0])]) as Record<StatusFilter, number>;
    for (const item of items) counts[item.normalizedStatus] += 1;
    return counts;
  }, [items]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.normalizedStatus !== statusFilter) return false;
      if (packageFilter !== "all" && item.seoPackage !== packageFilter) return false;
      if (!needle) return true;
      return [
        item.client,
        item.email,
        item.orderNumber,
        item.seoPackage,
        item.primaryKeyword,
        item.city,
        item.notes,
        item.sourceSection,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [items, packageFilter, search, statusFilter]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || packageFilter !== "all";
  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: statusCounts.all },
    ...gmbOperationStatuses.map((status) => ({
      value: status,
      label: gmbOperationStatusLabels[status],
      count: statusCounts[status],
    })),
  ];
  const columns: DepartmentWorkColumn<GmbOperationItem>[] = [
    { key: "client", header: "Client", width: hasNotes ? "22%" : "26%", render: (item) => <ClampText value={clientLabel(item)} />, title: (item) => item.client },
    { key: "package", header: "Package", width: hasNotes ? "16%" : "19%", hideOnTablet: true, render: (item) => <ClampText value={item.seoPackage ?? "—"} />, title: (item) => item.seoPackage ?? undefined },
    { key: "content", header: "Content", width: hasNotes ? "12%" : "14%", render: (item) => <GmbStatus status={item.contentStage.state} /> },
    { key: "posting", header: "Posting", width: hasNotes ? "12%" : "14%", render: (item) => <GmbStatus status={item.postingStage.state} /> },
    { key: "status", header: "Status", width: hasNotes ? "12%" : "14%", render: (item) => <GmbStatus status={item.normalizedStatus} /> },
    ...(hasNotes ? [{ key: "notes", header: "Notes", width: "14%", render: (item: GmbOperationItem) => <NoteCell item={item} /> }] : []),
    { key: "outputs", header: "Outputs", width: hasNotes ? "12%" : "13%", render: (item) => <DepartmentOutputs resources={stages(item)} /> },
  ];

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setPackageFilter("all");
  }

  function changeMonth(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="dept-workflow gmb-workflow">
      <DepartmentWorkflowHeader title="GMB Management" count={state === "ready" ? items.length : undefined} countLabel="clients" />
      {state === "unconfigured" ? <DepartmentConnectionState departmentName="GMB Management" headingId="gmb-management-connection-title" icon={<MapPinned aria-hidden="true" size={15} strokeWidth={1.8} />} /> : null}
      {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>GMB Management workflow is temporarily unavailable.</strong><p>The workflow could not be refreshed right now. Try again shortly.</p></div> : null}
      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search clients, cities, keywords…"
            searchAriaLabel="Search GMB Management work"
            selects={[]}
            secondaryFilters={packageOptions.length > 0 ? [{ key: "package", label: "Package", allLabel: "All Packages", ariaLabel: "Filter by SEO package", value: packageFilter, options: packageOptions, onChange: setPackageFilter }] : []}
            trailingSelects={[
              { allLabel: "All Statuses", ariaLabel: "Filter by status", value: statusFilter, options: [], onChange: (value) => setStatusFilter(value as StatusFilter), countedOptions: statusSelectOptions },
            ]}
            trailingControl={monthOptions.length > 0 ? <AnimatedSelect name="gmb-management-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} onChange={changeMonth} options={monthOptions.map((option) => ({ value: option.value, label: option.label }))} /> : null}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
          <div key={`${sourceTab}|${packageFilter}`} className="dept-filter-results">
            {visibleItems.length === 0 ? <p className="dept-empty">{items.length === 0 && !hasActiveFilters ? "No GMB Management workflow records were found." : "No GMB Management work matches these filters."}</p> : (
              <>
                <DepartmentWorkTable columns={columns} rows={visibleItems} selectedRowId={selectedItemId} onSelectRow={(item) => setSelectedItemId(item.id)} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
                <DepartmentWorkListMobile
                  rows={visibleItems}
                  onSelectRow={(item) => setSelectedItemId(item.id)}
                  renderTitle={clientLabel}
                  renderStatus={(item) => <GmbStatus status={item.normalizedStatus} />}
                  renderDetailLine={(item) => item.notes ?? item.seoPackage ?? item.sourceSection}
                  renderMetaLeft={(item) => `Content: ${gmbOperationStatusLabels[item.contentStage.state]}`}
                  renderMetaRight={(item) => `Posting: ${gmbOperationStatusLabels[item.postingStage.state]}`}
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

function stages(item: GmbOperationItem): GmbWorkflowStage[] {
  return [item.contentStage, item.postingStage];
}

function GmbStatus({ status }: { status: GmbOperationStatus }) {
  return <WorkflowStatus label={gmbOperationStatusLabels[status]} tone={STATUS_TONE[status]} />;
}

function clientLabel(item: GmbOperationItem): string {
  if (!item.clientUrl) return item.client;
  const prefix = item.client.slice(0, item.client.indexOf(item.clientUrl)).replace(/[\s-]+$/, "").trim();
  return prefix || formatCleanDomain(item.clientUrl);
}

function InspectorHeader({ item }: { item: GmbOperationItem }) {
  return <div className="dept-inspector-identity"><strong>{clientLabel(item)}</strong><GmbStatus status={item.normalizedStatus} />{item.clientUrl ? <DepartmentResourceLink href={item.clientUrl} label="Open website" /> : null}</div>;
}

function inspectorTabs(item: GmbOperationItem, sourceTab: string | null, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const overviewFields = [
    { label: "Package", value: item.seoPackage },
    { label: "Order #", value: item.orderNumber },
    { label: "Primary keyword", value: item.primaryKeyword },
    { label: "City", value: item.city },
    { label: "Email", value: item.email },
  ].filter((field): field is { label: string; value: string } => field.value !== null);
  const resources = [
    ...(item.clientUrl ? [{ label: "Website", href: item.clientUrl }] : []),
    ...(item.loginUrl ? [{ label: "Login", href: item.loginUrl }] : []),
    ...(item.promptSopUrl ? [{ label: "Prompt / SOP", href: item.promptSopUrl }] : []),
    ...(item.onboardingSheetUrl ? [{ label: "Onboarding sheet", href: item.onboardingSheetUrl }] : []),
    ...stages(item).filter((stage) => stage.outputUrl).map((stage) => ({ label: stage.label, href: stage.outputUrl! })),
  ];
  const workflowSections = [
    { content: <div className="onpage-deliverables">{stages(item).map((stage) => <StageRow key={stage.key} stage={stage} />)}</div> },
  ];

  return [
    { id: "overview", label: "Overview", sections: [{ fields: overviewFields.length > 0 ? overviewFields : [{ label: "Details", value: "No additional overview fields recorded." }] }] },
    { id: "gmb-work", label: "GMB Work", sections: workflowSections },
    ...(item.notes ? [{ id: "notes", label: "Notes / Blockers", sections: [{ fields: [{ label: "Source note", value: item.notes }] }] }] : []),
    { id: "resources", label: "Resources", sections: [{ content: resources.length > 0 ? <div className="dept-resource-list">{resources.map((resource) => <div key={`${resource.label}-${resource.href}`} className="dept-resource-row"><span>{resource.label}</span><DepartmentResourceLink href={resource.href} label="Open" icon={resource.label === "Login" ? <KeyRound aria-hidden="true" size={13} /> : <FileText aria-hidden="true" size={13} />} /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: sourceTab ?? item.sourceTab },
      { label: "Section", value: item.sourceSection },
      { label: "Access", value: "Read only" },
      { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}

function StageRow({ stage }: { stage: GmbWorkflowStage }) {
  return <div className="onpage-deliverable-row"><div><strong>{stage.label}</strong>{stage.output && !stage.outputUrl ? <span>{stage.output}</span> : null}</div><div className="onpage-deliverable-action"><GmbStatus status={stage.state} />{stage.outputUrl ? <DepartmentResourceLink href={stage.outputUrl} label="Open" /> : null}</div></div>;
}

function distinctSorted(items: readonly GmbOperationItem[], pick: (item: GmbOperationItem) => string | null): string[] {
  return [...new Set(items.map(pick).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}
