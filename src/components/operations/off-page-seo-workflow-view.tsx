"use client";

import { ExternalLink, Link2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  OFF_PAGE_DELIVERABLE_GROUPS,
  offPageOperationStatusLabels,
  offPageOperationStatuses,
  type OffPageDeliverable,
  type OffPageOperationItem,
  type OffPageOperationStatus,
} from "../../domain/operations/off-page-seo-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { OperationsWorkflowMonthOption } from "../../lib/integrations/operations-google-sheets";
import { WorkflowMonthSelect } from "./workflow-month-select";
import { DepartmentConnectionState } from "./department-connection-state";
import { DepartmentOutputs, type DepartmentOutputResource } from "./department-outputs";
import { DepartmentRecordInspector, type DepartmentInspectorSection, type DepartmentInspectorTab } from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

export type OffPageSeoWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: OffPageSeoWorkflowViewState;
  items: OffPageOperationItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
  monthOptions?: OperationsWorkflowMonthOption[];
  selectedMonth?: string | null;
};

type StatusFilter = "all" | OffPageOperationStatus;

const STATUS_TONE: Record<OffPageOperationStatus, WorkflowStatusTone> = {
  not_started: "neutral",
  in_progress: "info",
  stuck: "warning",
  paused: "neutral",
  cancelled: "neutral",
  completed: "positive",
};

function outputsFor(item: OffPageOperationItem): DepartmentOutputResource[] {
  return [
    ...item.deliverables.map((deliverable) => ({ key: deliverable.key, label: deliverable.label, outputUrl: deliverable.outputUrl })),
    ...(item.loginUrl ? [{ key: "login", label: "Onboarding / Access Sheet", outputUrl: item.loginUrl }] : []),
  ];
}

export function OffPageSeoWorkflowView({ state, items, sourceTab, lastSyncedAt, monthOptions = [], selectedMonth = null }: Props) {
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
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries([["all", items.length], ...offPageOperationStatuses.map((status) => [status, 0])]) as Record<StatusFilter, number>;
    for (const item of items) counts[item.normalizedStatus] += 1;
    return counts;
  }, [items]);
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.normalizedStatus !== statusFilter) return false;
      if (packageFilter !== "all" && item.seoPackage !== packageFilter) return false;
      if (!needle) return true;
      return [item.client, item.email, item.orderNumber, item.seoPackage, item.primaryKeyword, item.city, item.attention, ...item.deliverables.map((deliverable) => deliverable.label)]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [items, packageFilter, search, statusFilter]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || packageFilter !== "all";
  const columns: DepartmentWorkColumn<OffPageOperationItem>[] = [
    { key: "client", header: "Client", width: "23%", render: clientLabel, title: (item) => item.client },
    { key: "package", header: "Package", width: "19%", render: (item) => item.seoPackage ?? "—", title: (item) => item.seoPackage ?? undefined },
    { key: "progress", header: "Progress", width: "10%", render: (item) => `${item.completedDeliverables} / ${item.applicableDeliverables}` },
    { key: "status", header: "Status", width: "14%", render: (item) => <OffPageStatus status={item.normalizedStatus} /> },
    { key: "attention", header: "Attention", width: "20%", render: (item) => item.attention ?? "—", title: (item) => item.attention ?? undefined },
    { key: "outputs", header: "Outputs", width: "14%", render: (item) => <DepartmentOutputs resources={outputsFor(item)} noun="output" /> },
  ];

  function clearFilters() {
    setSearch(""); setStatusFilter("all"); setPackageFilter("all");
  }
  function changeMonth(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="dept-workflow dept-workflow-offpage">
      <DepartmentWorkflowHeader title="Off-page SEO" count={state === "ready" ? items.length : undefined} countLabel="clients" />
      {state === "unconfigured" ? <DepartmentConnectionState departmentName="Off-page SEO" headingId="off-page-seo-connection-title" icon={<Link2 aria-hidden="true" size={15} strokeWidth={1.8} />} /> : null}
      {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>Off-page SEO workflow is temporarily unavailable.</strong><p>The workflow could not be refreshed right now. Try again shortly.</p></div> : null}
      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search clients, packages, deliverables…"
            searchAriaLabel="Search Off-page SEO work"
            selects={[]}
            secondaryFilters={[
              { key: "package", label: "Package", allLabel: "All Packages", ariaLabel: "Filter by SEO package", value: packageFilter, options: packageOptions, onChange: setPackageFilter },
            ]}
            trailingSelects={[
              { allLabel: "All Statuses", ariaLabel: "Filter by status", value: statusFilter, options: [], onChange: (value) => setStatusFilter(value as StatusFilter), countedOptions: [{ value: "all", label: "All Statuses", count: statusCounts.all }, ...offPageOperationStatuses.map((status) => ({ value: status, label: offPageOperationStatusLabels[status], count: statusCounts[status] }))] },
            ]}
            trailingControl={monthOptions.length > 0 ? <WorkflowMonthSelect name="off-page-seo-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} onChange={changeMonth} options={monthOptions.map((option) => ({ value: option.value, label: option.label }))} /> : null}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
          <div key={`${sourceTab}|${packageFilter}`} className="dept-filter-results">
            {visibleItems.length === 0 ? <p className="dept-empty">{items.length === 0 && !hasActiveFilters ? "No Off-page SEO workflow records were found." : "No Off-page SEO work matches these filters."}</p> : (
              <>
                <DepartmentWorkTable columns={columns} rows={visibleItems} selectedRowId={selectedItemId} onSelectRow={(item) => setSelectedItemId(item.id)} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
                <DepartmentWorkListMobile rows={visibleItems} onSelectRow={(item) => setSelectedItemId(item.id)} renderTitle={clientLabel} renderStatus={(item) => <OffPageStatus status={item.normalizedStatus} />} renderDetailLine={(item) => item.attention ?? item.seoPackage ?? "Package not recorded"} renderMetaLeft={(item) => `${item.completedDeliverables} / ${item.applicableDeliverables} complete`} renderMetaRight={(item) => item.seoPackage ?? "—"} renderAction={(item) => <DepartmentOutputs resources={outputsFor(item)} noun="output" />} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
              </>
            )}
          </div>
        </>
      ) : null}
      <DepartmentRecordInspector open={selectedItem !== null} header={selectedItem ? <InspectorHeader item={selectedItem} /> : null} tabs={selectedItem ? inspectorTabs(selectedItem, sourceTab, lastSyncedAt) : []} onClose={() => setSelectedItemId(null)} />
    </div>
  );
}

function OffPageStatus({ status }: { status: OffPageOperationStatus }) {
  return <WorkflowStatus label={offPageOperationStatusLabels[status]} tone={STATUS_TONE[status]} />;
}

function clientLabel(item: OffPageOperationItem): string {
  if (!item.clientUrl) return item.client;
  const prefix = item.client.slice(0, item.client.indexOf(item.clientUrl)).replace(/[\s-]+$/, "").trim();
  return prefix || formatCleanDomain(item.clientUrl);
}

function InspectorHeader({ item }: { item: OffPageOperationItem }) {
  return <div className="dept-inspector-identity"><strong>{clientLabel(item)}</strong><OffPageStatus status={item.normalizedStatus} />{item.clientUrl ? <DepartmentResourceLink href={item.clientUrl} label="Open website" /> : null}</div>;
}

function inspectorTabs(item: OffPageOperationItem, sourceTab: string | null, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const resources = outputsFor(item).filter((resource) => resource.outputUrl !== null) as { key: string; label: string; outputUrl: string }[];
  const grouped = new Set<string>();
  const groupSections: DepartmentInspectorSection[] = OFF_PAGE_DELIVERABLE_GROUPS.flatMap((group) => {
    const rows = item.deliverables.filter((deliverable) => group.keys.includes(deliverable.key));
    rows.forEach((deliverable) => grouped.add(deliverable.key));
    return rows.length > 0 ? [{ title: group.title, content: <div className="onpage-deliverables">{rows.map((deliverable) => <DeliverableRow key={deliverable.key} deliverable={deliverable} />)}</div> }] : [];
  });
  const ungrouped = item.deliverables.filter((deliverable) => !grouped.has(deliverable.key));
  const ungroupedSection: DepartmentInspectorSection[] = ungrouped.length > 0
    ? [{ title: groupSections.length > 0 ? "Other Work" : undefined, content: <div className="onpage-deliverables">{ungrouped.map((deliverable) => <DeliverableRow key={deliverable.key} deliverable={deliverable} />)}</div> }]
    : [];

  return [
    { id: "overview", label: "Overview", sections: [{ fields: [
      { label: "Package", value: item.seoPackage ?? "—" },
      { label: "Progress", value: `${item.completedDeliverables} / ${item.applicableDeliverables}` },
      { label: "Status", value: offPageOperationStatusLabels[item.normalizedStatus] },
      ...(item.attention ? [{ label: "Attention", value: item.attention }] : []),
      { label: "Order #", value: item.orderNumber ?? "—" }, { label: "Primary keyword", value: item.primaryKeyword ?? "—" },
      { label: "City", value: item.city ?? "—" }, { label: "Email", value: item.email ?? "—" },
    ] }] },
    { id: "off-page-work", label: "Off-page Work", sections: [...groupSections, ...ungroupedSection] },
    { id: "resources", label: "Resources", sections: [{ content: resources.length > 0 ? <div className="dept-resource-list">{resources.map((resource) => <div key={resource.key} className="dept-resource-row"><span>{resource.label}</span><DepartmentResourceLink href={resource.outputUrl} label="Open" icon={resource.key === "login" ? <Link2 aria-hidden="true" size={13} /> : <ExternalLink aria-hidden="true" size={13} />} /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: sourceTab ?? item.sourceTab }, { label: "Section", value: item.sourceSection },
      { label: "Source row", value: String(item.sourceRow) }, { label: "Access", value: "Read only" },
      { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}

function DeliverableRow({ deliverable }: { deliverable: OffPageDeliverable }) {
  return <div className="onpage-deliverable-row"><div><strong>{deliverable.label}</strong>{deliverable.output && !deliverable.outputUrl ? <span>{deliverable.output}</span> : null}</div><div className="onpage-deliverable-action"><OffPageStatus status={deliverable.state} />{deliverable.outputUrl ? <DepartmentResourceLink href={deliverable.outputUrl} label="Open" icon={<ExternalLink aria-hidden="true" size={12} />} /> : null}</div></div>;
}

function distinctSorted(items: readonly OffPageOperationItem[], pick: (item: OffPageOperationItem) => string | null): string[] {
  return [...new Set(items.map(pick).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}
