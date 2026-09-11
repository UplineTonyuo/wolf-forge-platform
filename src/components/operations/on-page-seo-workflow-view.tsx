"use client";

import { ExternalLink, FileText, KeyRound, ScanSearch } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  onPageSeoOperationStatusLabels,
  onPageSeoOperationStatuses,
  type OnPageSeoDeliverable,
  type OnPageSeoOperationItem,
  type OnPageSeoOperationStatus,
} from "../../domain/operations/on-page-seo-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { OperationsWorkflowMonthOption } from "../../lib/integrations/operations-google-sheets";
import { AnimatedSelect, type AnimatedSelectOption } from "../ui/animated-select";
import { DepartmentConnectionState } from "./department-connection-state";
import { OnPageSeoOutputs } from "./on-page-seo-outputs";
import { DepartmentRecordInspector, type DepartmentInspectorTab } from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

export type OnPageSeoWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: OnPageSeoWorkflowViewState;
  items: OnPageSeoOperationItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
  monthOptions?: OperationsWorkflowMonthOption[];
  selectedMonth?: string | null;
};

type StatusFilter = "all" | OnPageSeoOperationStatus;

const STATUS_TONE: Record<OnPageSeoOperationStatus, WorkflowStatusTone> = {
  not_started: "neutral",
  in_progress: "info",
  stuck: "warning",
  paused: "neutral",
  cancelled: "neutral",
  completed: "positive",
};

/** Single-line ellipsis for the two free-text table columns (Client, Package) — real source values run up to
 * ~55 characters ("Platinum SEO Success Blueprint (100 Targeted Keywords)"); without this, a `<td>`'s default
 * text wrapping grows that one row taller than its neighbors instead of overflowing sideways, breaking the
 * table's otherwise-uniform row rhythm. The column's own `title` (already set on the `<td>`) still carries the
 * full value — this only changes how the cell paints, never the underlying string. */
function ClampText({ value }: { value: string }) {
  return <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>;
}
/** Safe-wraps a free-text inspector value that (unlike status/progress) has no fixed vocabulary and can be
 * arbitrarily long — same fix as Technical SEO's inspector overflow: `overflow-wrap: anywhere` is what actually
 * shrinks the element's intrinsic width inside `.dept-inspector-field`'s flex row, not just `word-break`. */
function WrapText({ value }: { value: string }) {
  return <span style={{ display: "block", minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{value}</span>;
}

export function OnPageSeoWorkflowView({ state, items, sourceTab, lastSyncedAt, monthOptions = [], selectedMonth = null }: Props) {
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
    const counts = Object.fromEntries([["all", items.length], ...onPageSeoOperationStatuses.map((status) => [status, 0])]) as Record<StatusFilter, number>;
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
      return [item.client, item.email, item.assignedVa, item.owner, item.orderNumber, item.seoPackage, item.primaryKeyword, item.city, ...item.deliverables.map((deliverable) => deliverable.label)]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [items, packageFilter, search, statusFilter, vaFilter]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || vaFilter !== "all" || packageFilter !== "all";
  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: statusCounts.all },
    ...onPageSeoOperationStatuses.map((status) => ({
      value: status,
      label: onPageSeoOperationStatusLabels[status],
      count: statusCounts[status],
    })),
  ];
  const columns: DepartmentWorkColumn<OnPageSeoOperationItem>[] = [
    { key: "client", header: "Client", width: "26%", render: (item) => <ClampText value={clientLabel(item)} />, title: (item) => item.client },
    { key: "package", header: "Package", width: "20%", render: (item) => <ClampText value={item.seoPackage ?? "—"} />, title: (item) => item.seoPackage ?? undefined },
    { key: "progress", header: "Progress", width: "10%", render: (item) => `${item.completedDeliverables} / ${item.applicableDeliverables}` },
    { key: "status", header: "Status", width: "14%", render: (item) => <OnPageStatus status={item.normalizedStatus} /> },
    ...(hasCredibleVaData ? [{ key: "assigned", header: "Assigned", width: "13%", render: (item: OnPageSeoOperationItem) => item.assignedVa ?? "—" }] : []),
    { key: "outputs", header: "Outputs", width: "13%", render: (item) => <OnPageSeoOutputs deliverables={item.deliverables} /> },
  ];

  function clearFilters() {
    setSearch(""); setStatusFilter("all"); setVaFilter("all"); setPackageFilter("all");
  }
  function changeMonth(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="dept-workflow">
      <DepartmentWorkflowHeader title="On-page SEO" count={state === "ready" ? items.length : undefined} countLabel="clients" />
      {state === "unconfigured" ? <DepartmentConnectionState departmentName="On-page SEO" headingId="on-page-seo-connection-title" icon={<ScanSearch aria-hidden="true" size={15} strokeWidth={1.8} />} /> : null}
      {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>On-page SEO workflow is temporarily unavailable.</strong><p>The workflow could not be refreshed right now. Try again shortly.</p></div> : null}
      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search clients, packages, deliverables…"
            searchAriaLabel="Search On-page SEO work"
            selects={hasCredibleVaData ? [
              { allLabel: "All VAs", ariaLabel: "Filter by assigned VA", value: vaFilter, options: vaOptions, onChange: setVaFilter, size: "compact" },
            ] : []}
            secondaryFilters={[
              { key: "package", label: "Package", allLabel: "All Packages", ariaLabel: "Filter by SEO package", value: packageFilter, options: packageOptions, onChange: setPackageFilter },
            ]}
            trailingSelects={[
              { allLabel: "All Statuses", ariaLabel: "Filter by status", value: statusFilter, options: [], onChange: (value) => setStatusFilter(value as StatusFilter), countedOptions: statusSelectOptions },
            ]}
            trailingControl={monthOptions.length > 0 ? <AnimatedSelect name="on-page-seo-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} onChange={changeMonth} options={monthOptions.map((option) => ({ value: option.value, label: option.label }))} /> : null}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
          <div key={`${sourceTab}|${vaFilter}|${packageFilter}`} className="dept-filter-results">
            {visibleItems.length === 0 ? <p className="dept-empty">{items.length === 0 && !hasActiveFilters ? "No On-page SEO workflow records were found." : "No On-page SEO work matches these filters."}</p> : (
              <>
                <DepartmentWorkTable columns={columns} rows={visibleItems} selectedRowId={selectedItemId} onSelectRow={(item) => setSelectedItemId(item.id)} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
                <DepartmentWorkListMobile rows={visibleItems} onSelectRow={(item) => setSelectedItemId(item.id)} renderTitle={clientLabel} renderStatus={(item) => <OnPageStatus status={item.normalizedStatus} />} renderDetailLine={(item) => item.seoPackage ?? "Package not recorded"} renderMetaLeft={(item) => `${item.completedDeliverables} / ${item.applicableDeliverables} complete`} renderMetaRight={(item) => item.assignedVa ?? "Unassigned"} renderAction={(item) => <OnPageSeoOutputs deliverables={item.deliverables} />} getRowLabel={(item) => `Open ${clientLabel(item)}`} />
              </>
            )}
          </div>
        </>
      ) : null}
      <DepartmentRecordInspector open={selectedItem !== null} header={selectedItem ? <InspectorHeader item={selectedItem} /> : null} tabs={selectedItem ? inspectorTabs(selectedItem, sourceTab, lastSyncedAt) : []} onClose={() => setSelectedItemId(null)} />
    </div>
  );
}

function OnPageStatus({ status }: { status: OnPageSeoOperationStatus }) {
  return <WorkflowStatus label={onPageSeoOperationStatusLabels[status]} tone={STATUS_TONE[status]} />;
}

function clientLabel(item: OnPageSeoOperationItem): string {
  if (!item.clientUrl) return item.client;
  const prefix = item.client.slice(0, item.client.indexOf(item.clientUrl)).replace(/[\s-]+$/, "").trim();
  return prefix || formatCleanDomain(item.clientUrl);
}

function InspectorHeader({ item }: { item: OnPageSeoOperationItem }) {
  return <div className="dept-inspector-identity"><strong>{clientLabel(item)}</strong><OnPageStatus status={item.normalizedStatus} />{item.clientUrl ? <DepartmentResourceLink href={item.clientUrl} label="Open website" /> : null}</div>;
}

function inspectorTabs(item: OnPageSeoOperationItem, sourceTab: string | null, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const resources = [
    ...(item.loginUrl ? [{ label: "Login", href: item.loginUrl, icon: <KeyRound aria-hidden="true" size={13} /> }] : []),
    ...(item.promptSopUrl ? [{ label: "Prompt / SOP", href: item.promptSopUrl, icon: <FileText aria-hidden="true" size={13} /> }] : []),
  ];
  // `assignmentSourceValue` is the raw Assigned VA cell before the credible-assignee check — when that check
  // rejects it (e.g. "password is incorrect.", "Site Error", "login is commented"), the text is real operational
  // signal that answers "is anything stuck?", but until now it was dropped entirely rather than reassigned or
  // shown anywhere. Surfacing it here changes no domain logic: `assignedVa`/`assignmentSourceValue` are both
  // already-parsed fields on the item, this only decides whether an already-derived value gets rendered.
  const overviewFields: { label: string; value: ReactNode }[] = [
    { label: "Package", value: item.seoPackage ?? "—" }, { label: "Assigned VA", value: item.assignedVa ?? "—" },
    ...(!item.assignedVa && item.assignmentSourceValue ? [{ label: "Note", value: <WrapText value={item.assignmentSourceValue} /> }] : []),
    { label: "Owner", value: item.owner ?? "—" }, { label: "Progress", value: `${item.completedDeliverables} / ${item.applicableDeliverables}` },
    { label: "Order #", value: item.orderNumber ?? "—" }, { label: "Primary keyword", value: item.primaryKeyword ?? "—" },
    { label: "City", value: item.city ?? "—" }, { label: "Email", value: item.email ?? "—" },
  ];
  return [
    { id: "overview", label: "Overview", sections: [{ fields: overviewFields }] },
    { id: "on-page-work", label: "On-page Work", sections: [{ content: <div className="onpage-deliverables">{item.deliverables.map((deliverable) => <DeliverableRow key={deliverable.key} deliverable={deliverable} />)}</div> }] },
    { id: "resources", label: "Resources", sections: [{ content: resources.length > 0 ? <div className="dept-resource-list">{resources.map((resource) => <div key={resource.label} className="dept-resource-row"><span>{resource.label}</span><DepartmentResourceLink href={resource.href} label="Open" icon={resource.icon} /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: sourceTab ?? item.sourceTab }, { label: "Section", value: item.sourceSection },
      { label: "Access", value: "Read only" }, { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}

function DeliverableRow({ deliverable }: { deliverable: OnPageSeoDeliverable }) {
  return <div className="onpage-deliverable-row"><div><strong>{deliverable.label}</strong>{deliverable.output && !deliverable.outputUrl ? <span>{deliverable.output}</span> : null}</div><div className="onpage-deliverable-action"><OnPageStatus status={deliverable.state} />{deliverable.outputUrl ? <DepartmentResourceLink href={deliverable.outputUrl} label="Open" icon={<ExternalLink aria-hidden="true" size={12} />} /> : null}</div></div>;
}

function distinctSorted(items: readonly OnPageSeoOperationItem[], pick: (item: OnPageSeoOperationItem) => string | null): string[] {
  return [...new Set(items.map(pick).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}
