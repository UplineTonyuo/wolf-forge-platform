"use client";

import { ScanSearch } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { TechnicalSeoItem } from "../../domain/operations/technical-seo-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { OperationsWorkflowMonthOption } from "../../lib/integrations/operations-google-sheets";
import { WorkflowMonthSelect } from "./workflow-month-select";
import type { AnimatedSelectOption } from "../ui/animated-select";
import { DepartmentConnectionState } from "./department-connection-state";
import { DepartmentOutputs } from "./department-outputs";
import { DepartmentRecordInspector, type DepartmentInspectorTab } from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

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
const notePreview = (item: TechnicalSeoItem) => item.notes.length ? item.notes.map((note) => note.value).join(" · ") : null;
const STATUS_TONE_COLOR: Record<WorkflowStatusTone, string> = {
  positive: "#1f8564",
  warning: "#8a6a1f",
  info: "var(--wf-navy)",
  neutral: "var(--wf-text-muted)",
};
function statusTone(value: string): WorkflowStatusTone {
  return value === "Completed" ? "positive" : value === "Stuck" ? "warning" : value === "In Progress" ? "info" : "neutral";
}
/** The dot+label pill, reproduced locally (not `.workflow-status`, which is `display: inline-flex` with no `min-width: 0` on its bare text child — flexbox's default `min-width: auto` refuses to shrink that text, so a long source value keeps its full intrinsic width and visually spills into whatever sits next to it). Both variants below give the label its own flex-item span with `min-width: 0`, which is the actual fix; `clamp`/`wrap` only change what that span does with the space it's forced to fit into. */
function StatusPill({ value, mode }: { value: string; mode: "clamp" | "wrap" }) {
  const tone = statusTone(value);
  return (
    <span
      title={mode === "clamp" ? value : undefined}
      style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%", color: STATUS_TONE_COLOR[tone], fontSize: 12, fontWeight: 500 }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto", background: "currentColor" }} />
      <span
        style={
          mode === "clamp"
            ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
            : { minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }
        }
      >
        {value}
      </span>
    </span>
  );
}
/**
 * `clamp` (table cells, mobile card): single-line ellipsis — the cell's own
 * fixed column width can never be exceeded, full value stays in `title`.
 * `wrap` (inspector evidence rows AND the inspector header identity badge):
 * no truncation — wraps across lines instead, since `overflow-wrap: anywhere`
 * shrinks the element's own intrinsic width (unlike `word-break: break-word`
 * alone, a distinction that mattered in practice: the header identity area
 * (`.dept-inspector-identity`, a single-column grid inside a flex header)
 * kept forcing the whole 420px panel to ~545px wide until this same
 * anywhere-wrap treatment was applied there too — every one of Technical
 * SEO's own status renders needs it, since only this department's status
 * derivation can legitimately produce a raw, unbounded source string.
 * Every other department's inspector header keeps using the shared,
 * unwrapped `WorkflowStatus` (their status vocabularies are always short).
 */
function Status({ value, mode }: { value: string; mode?: "clamp" | "wrap" }) {
  if (!mode) return <WorkflowStatus label={value} tone={statusTone(value)} />;
  return <StatusPill value={value} mode={mode} />;
}
function Resources({ item }: { item: TechnicalSeoItem }) {
  return <DepartmentOutputs noun="resource" resources={item.resources.map((resource, index) => ({ ...resource, key: String(index) }))} />;
}
/** Single-line ellipsis for the free-text table columns (Package) — real source values run up to ~55 characters
 * ("Platinum SEO Success Blueprint (100 Targeted Keywords)"); without this, a `<td>`'s default text wrapping
 * grows that one row taller than its neighbors instead of overflowing sideways. Matches the same fix already
 * applied to the sibling On-page/YouTube/GMB workflow views. */
function ClampText({ value }: { value: string }) {
  return <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>;
}
/** Safe-wraps the Source tab's raw block-header value (`item.sourceSection`) — this department's own source
 * sheet embeds full URLs inside its section header text (e.g. "MONTH of JULY- Leader(JOHN) KPI- https://docs
 * .google.com/..."), which is long enough with no break points to trigger the same `.dept-inspector-field`
 * flexbox blowout already fixed for Status above (`display: flex` + `<strong>` with no `min-width: 0`). */
function WrapText({ value }: { value: string }) {
  return <span style={{ display: "block", minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{value}</span>;
}
/** Compact, source-honest blocker/note preview — clamped to one line in the main table so a long operational note (e.g. "NEED LOGIN CREDENTIALS") never expands the row; the full text is never rewritten, only visually clamped, and stays fully readable via `title` here and unclamped in the inspector's own Notes / Blockers tab. */
function NoteCell({ item }: { item: TechnicalSeoItem }) {
  const preview = notePreview(item);
  if (!preview) return <>—</>;
  return (
    <span
      title={item.notes.map((note) => `${note.label}: ${note.value}`).join("\n")}
      style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {preview}
    </span>
  );
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
  const hasNotes = items.some((item) => item.notes.length > 0);
  const columns: DepartmentWorkColumn<TechnicalSeoItem>[] = [
    { key: "client", header: "Client", width: "22%", render: label, title: (item) => item.client },
    ...(packages.length ? [{ key: "package", header: "Package", width: "11%", hideOnTablet: true, render: (item: TechnicalSeoItem) => <ClampText value={item.seoPackage ?? "—"} />, title: (item: TechnicalSeoItem) => item.seoPackage ?? undefined }] : []),
    ...(assignees.length ? [{ key: "assigned", header: "Assigned", width: "10%", hideOnTablet: true, render: (item: TechnicalSeoItem) => item.assignedVa ?? "—" }] : []),
    ...orderedPhases.map((phase) => ({ key: phase, header: phase, width: "10%", hideOnTablet: phase === "Ranking", render: (item: TechnicalSeoItem) => <Status value={phaseStatus(item, phase)} mode="clamp" /> })),
    { key: "status", header: "Status", width: "11%", render: (item) => <Status value={item.status} mode="clamp" /> },
    ...(hasNotes ? [{ key: "notes", header: "Notes", width: "16%", render: (item: TechnicalSeoItem) => <NoteCell item={item} /> }] : []),
    { key: "resources", header: "Resources", width: "12%", render: (item) => <Resources item={item} /> },
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
        trailingControl={monthOptions.length ? <WorkflowMonthSelect name="technical-seo-month" label="Month" menuLabel="Select month" value={selectedMonth ?? monthOptions[0]!.value} options={monthOptions.map((month) => ({ value: month.value, label: month.label }))} onChange={(value) => { const next = new URLSearchParams(params.toString()); next.set("month", value); router.push(`${pathname}?${next}`); }} /> : null}
        hasActiveFilters={hasFilters} onClearFilters={() => { setSearch(""); setStatus("all"); setPack("all"); setAssignee("all"); }} />
      {visible.length ? <>
        <DepartmentWorkTable columns={columns} rows={visible} selectedRowId={selectedId} onSelectRow={(item) => setSelectedId(item.id)} getRowLabel={(item) => `Open ${label(item)}`} />
        <DepartmentWorkListMobile rows={visible} onSelectRow={(item) => setSelectedId(item.id)} renderTitle={label} renderStatus={(item) => <Status value={item.status} mode="clamp" />}
          renderDetailLine={(item) => notePreview(item) ?? `Technical: ${phaseStatus(item, "Technical")}`}
          renderMetaLeft={(item) => `Mobile: ${phaseStatus(item, "Mobile")}`}
          renderMetaRight={(item) => `Desktop: ${phaseStatus(item, "Desktop")}`}
          renderAction={(item) => <Resources item={item} />} getRowLabel={(item) => `Open ${label(item)}`} />
      </> : <p className="dept-empty">{items.length ? "No Technical SEO work matches these filters." : "No Technical SEO workflow records were found."}</p>}
    </> : null}
    <DepartmentRecordInspector open={Boolean(selected)} onClose={() => setSelectedId(null)} header={selected ? <div className="dept-inspector-identity"><strong>{label(selected)}</strong><Status value={selected.status} mode="wrap" />{selected.clientUrl ? <DepartmentResourceLink href={selected.clientUrl} label="Open website" /> : null}</div> : null} tabs={selected ? inspectorTabs(selected, lastSyncedAt) : []} />
  </div>;
}

function inspectorTabs(item: TechnicalSeoItem, lastSyncedAt: string | null): DepartmentInspectorTab[] {
  // `item.status` is never null (unlike the rest of this list), and is the one field here that can carry
  // an unbounded raw source string — the shared `DepartmentRecordInspector`'s generic field row
  // (`.dept-inspector-field { display: flex; justify-content: space-between }`, `<strong>{value}</strong>`
  // with no `min-width: 0`) has the exact same flexbox blowout as `.workflow-status`. `field.value` accepts
  // a `ReactNode`, so passing an already wrap-safe badge fixes this without touching that shared row at all.
  const fields: { label: string; value: ReactNode }[] = [
    { label: "Client", value: label(item) },
    { label: "Status", value: <Status value={item.status} mode="wrap" /> },
    ...[
      { label: "Package", value: item.seoPackage },
      { label: "Assigned VA", value: item.assignedVa },
      { label: "Order #", value: item.orderNumber },
      { label: "Primary keyword", value: item.primaryKeyword },
      { label: "City", value: item.city },
    ].filter((field): field is { label: string; value: string } => field.value !== null),
  ];
  const resources = [...(item.clientUrl ? [{ label: "Website", outputUrl: item.clientUrl }] : []), ...item.resources];
  return [
    { id: "overview", label: "Overview", sections: [{ fields }] },
    { id: "technical-work", label: "Technical Work", sections: [
      { content: <div className="onpage-deliverables">{item.evidence.map((field) => <div key={field.key} className="onpage-deliverable-row"><div><strong>{field.label}</strong>{field.output && !field.outputUrl ? <span>{field.output}</span> : null}</div><div className="onpage-deliverable-action"><Status value={field.rawStatus ?? "Not recorded"} mode="wrap" />{field.outputUrl ? <DepartmentResourceLink href={field.outputUrl} label="Open evidence" /> : null}</div></div>)}</div> },
      { content: <p className="dept-empty-resources">Completed requires explicit completion in every applicable evidence status. Links alone do not confirm completion. Blank statuses mean not recorded. No percentage is calculated because the source does not specify task applicability.</p> },
    ] },
    // A dedicated tab, not a buried subsection — an operator triaging a blocked client reaches the full, untruncated note in one click instead of scrolling past every evidence row first.
    ...(item.notes.length ? [{ id: "notes", label: "Notes / Blockers", sections: [{ fields: item.notes }] }] : []),
    { id: "resources", label: "Resources", sections: [{ content: resources.length ? <div className="dept-resource-list">{resources.map((resource, index) => <div className="dept-resource-row" key={index}><span>{resource.label}</span><DepartmentResourceLink href={resource.outputUrl} label="Open" /></div>)}</div> : <p className="dept-empty-resources">No shared resource links on this record.</p> }] },
    { id: "source", label: "Source", sections: [{ fields: [
      { label: "Sheet tab", value: item.sourceTab }, { label: "Section", value: <WrapText value={item.sourceSection} /> },
      { label: "Source row", value: String(item.sourceRow) }, { label: "Access", value: "Read only" },
      { label: "Last read", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
    ] }] },
  ];
}
