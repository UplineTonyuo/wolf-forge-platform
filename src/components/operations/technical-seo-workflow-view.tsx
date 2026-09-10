"use client";

import { ScanSearch } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { TechnicalSeoItem } from "../../domain/operations/technical-seo-workflow";
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
import { WorkflowStatus } from "./workflow-status";

type Props = {
  state: "ready" | "unconfigured" | "error";
  items: TechnicalSeoItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
  monthOptions?: OperationsWorkflowMonthOption[];
  selectedMonth?: string | null;
};
const label = (item: TechnicalSeoItem) => item.clientUrl && item.client === item.clientUrl ? formatCleanDomain(item.clientUrl) : item.client;
const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
const phaseStatus = (item: TechnicalSeoItem, phase: string) => item.phases.find((entry) => entry.label === phase)?.status ?? "Not recorded";

function Status({ value }: { value: string }) {
  return <WorkflowStatus label={value} tone={value === "Completed" ? "positive" : value === "Stuck" ? "warning" : value === "In Progress" ? "info" : "neutral"} />;
}
function Resources({ item }: { item: TechnicalSeoItem }) {
  return <DepartmentOutputs noun="resource" resources={item.resources.map((resource, index) => ({ ...resource, key: String(index) }))} />;
}

export function TechnicalSeoWorkflowView({ state, items, sourceTab, lastSyncedAt, monthOptions = [], selectedMonth = null }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pack, setPack] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastTab, setLastTab] = useState(sourceTab);
  if (lastTab !== sourceTab) {
    setLastTab(sourceTab); setSearch(""); setStatus("all"); setPack("all"); setAssignee("all"); setSelectedId(null);
  }
  const packages = distinct(items.map((item) => item.seoPackage));
  const assignees = distinct(items.map((item) => item.assignedVa));
  const statuses = distinct(items.map((item) => item.status));
  const phases = distinct(items.flatMap((item) => item.phases.map((phase) => phase.label)));
  const orderedPhases = ["Technical", "Mobile", "Desktop", "Ranking"].filter((phase) => phases.includes(phase));
  const needle = search.trim().toLowerCase();
  const visible = items.filter((item) => (status === "all" || item.status === status)
    && (pack === "all" || item.seoPackage === pack)
    && (assignee === "all" || item.assignedVa === assignee)
    && (!needle || [item.client, item.seoPackage, item.assignedVa, item.orderNumber, item.primaryKeyword, item.city,
      item.status, item.sourceSection, ...item.evidence.flatMap((field) => [field.label, field.rawStatus, field.output]),
      ...item.notes.map((note) => note.value)].filter(Boolean).join(" ").toLowerCase().includes(needle)));
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const columns: DepartmentWorkColumn<TechnicalSeoItem>[] = [
    { key: "client", header: "Client", width: "24%", render: label, title: (item) => item.client },
    ...(packages.length ? [{ key: "package", header: "Package", width: "18%", hideOnTablet: true, render: (item: TechnicalSeoItem) => item.seoPackage ?? "—", title: (item: TechnicalSeoItem) => item.seoPackage ?? undefined }] : []),
    ...(assignees.length ? [{ key: "assigned", header: "Assigned", hideOnTablet: true, render: (item: TechnicalSeoItem) => item.assignedVa ?? "—" }] : []),
    ...orderedPhases.map((phase) => ({ key: phase, header: phase, hideOnTablet: phase === "Ranking", render: (item: TechnicalSeoItem) => <Status value={phaseStatus(item, phase)} /> })),
    { key: "status", header: "Status", render: (item) => <Status value={item.status} /> },
    { key: "resources", header: "Resources", render: (item) => <Resources item={item} /> },
  ];
  const hasFilters = Boolean(needle || status !== "all" || pack !== "all" || assignee !== "all");
  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: items.length },
    ...statuses.map((value) => ({ value, label: value, count: items.filter((item) => item.status === value).length })),
  ];
  return <div className="dept-workflow">
    <DepartmentWorkflowHeader title="Technical SEO" count={state === "ready" ? items.length : undefined} countLabel="clients" />
    {state === "unconfigured" ? <DepartmentConnectionState departmentName="Technical SEO" headingId="technical-seo-connection" icon={<ScanSearch aria-hidden="true" size={15} />} /> : null}
    {state === "error" ? <div className="dept-source-unavailable" role="alert"><strong>Technical SEO workflow is temporarily unavailable.</strong><p>The source could not be read. Try again shortly.</p></div> : null}
    {state === "ready" ? <>
      <DepartmentWorkflowToolbar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search clients, tasks, keywords…" searchAriaLabel="Search Technical SEO work"
        selects={assignees.length ? [{ allLabel: "All VAs", ariaLabel: "Filter by assigned VA", value: assignee, options: assignees, onChange: setAssignee, size: "compact" as const }] : []}
        secondaryFilters={packages.length ? [{ key: "package", label: "Package", allLabel: "All Packages", ariaLabel: "Filter by SEO package", value: pack, options: packages, onChange: setPack }] : []}
        trailingSelects={[
          { allLabel: "All Statuses", ariaLabel: "Filter by status", value: status, options: [], onChange: setStatus, countedOptions: statusSelectOptions },
        ]}
        trailingControl={monthOptions.length ? <AnimatedSelect name="technical-seo-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} options={monthOptions.map((month) => ({ value: month.value, label: month.label }))} onChange={(value) => { const next = new URLSearchParams(params.toString()); next.set("month", value); router.push(`${pathname}?${next}`); }} /> : null}
        hasActiveFilters={hasFilters} onClearFilters={() => { setSearch(""); setStatus("all"); setPack("all"); setAssignee("all"); }} />
      {visible.length ? <>
        <DepartmentWorkTable columns={columns} rows={visible} selectedRowId={selectedId} onSelectRow={(item) => setSelectedId(item.id)} getRowLabel={(item) => `Open ${label(item)}`} />
        <DepartmentWorkListMobile rows={visible} onSelectRow={(item) => setSelectedId(item.id)} renderTitle={label} renderStatus={(item) => <Status value={item.status} />}
          renderDetailLine={(item) => `Technical: ${phaseStatus(item, "Technical")}`}
          renderMetaLeft={(item) => `Mobile: ${phaseStatus(item, "Mobile")}`}
          renderMetaRight={(item) => `Desktop: ${phaseStatus(item, "Desktop")}`}
          renderAction={(item) => <Resources item={item} />} getRowLabel={(item) => `Open ${label(item)}`} />
      </> : <p className="dept-empty">{items.length ? "No Technical SEO work matches these filters." : "No Technical SEO workflow records were found."}</p>}
    </> : null}
    <DepartmentRecordInspector open={Boolean(selected)} onClose={() => setSelectedId(null)} header={selected ? <div className="dept-inspector-identity"><strong>{label(selected)}</strong><Status value={selected.status} />{selected.clientUrl ? <DepartmentResourceLink href={selected.clientUrl} label="Open website" /> : null}</div> : null} tabs={selected ? inspectorTabs(selected, lastSyncedAt) : []} />
  </div>;
}

function inspectorTabs(item: TechnicalSeoItem, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  const fields = [
    { label: "Client", value: label(item) }, { label: "Status", value: item.status },
    { label: "Package", value: item.seoPackage }, { label: "Assigned VA", value: item.assignedVa },
    { label: "Order #", value: item.orderNumber }, { label: "Primary keyword", value: item.primaryKeyword }, { label: "City", value: item.city },
  ].filter((field): field is { label: string; value: string } => field.value !== null);
  const resources = [...(item.clientUrl ? [{ label: "Website", outputUrl: item.clientUrl }] : []), ...item.resources];
  return [
    { id: "overview", label: "Overview", sections: [{ fields }] },
    { id: "technical-work", label: "Technical Work", sections: [
      { content: <div className="onpage-deliverables">{item.evidence.map((field) => <div key={field.key} className="onpage-deliverable-row"><div><strong>{field.label}</strong>{field.output && !field.outputUrl ? <span>{field.output}</span> : null}</div><div className="onpage-deliverable-action"><Status value={field.rawStatus ?? "Not recorded"} />{field.outputUrl ? <DepartmentResourceLink href={field.outputUrl} label="Open evidence" /> : null}</div></div>)}</div> },
      ...(item.notes.length ? [{ title: "Notes / blockers", fields: item.notes }] : []),
      { content: <p className="dept-empty-resources">Completed requires explicit completion in every applicable evidence status. Links alone do not confirm completion. Blank statuses mean not recorded. No percentage is calculated because the source does not specify task applicability.</p> },
    ] },
    { id: "resources", label: "Resources", sections: [{ content: resources.length ? <div className="dept-resource-list">{resources.map((resource, index) => <div className="dept-resource-row" key={index}><span>{resource.label}</span><DepartmentResourceLink href={resource.outputUrl} label="Open" /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: item.sourceTab }, { label: "Section", value: item.sourceSection },
      { label: "Source row", value: String(item.sourceRow) }, { label: "Access", value: "Read only" },
      { label: "Last read", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}
