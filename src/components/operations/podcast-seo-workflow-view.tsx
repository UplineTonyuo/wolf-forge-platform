"use client";

import { FileText, KeyRound, Mic } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  podcastOperationStatusLabels,
  podcastOperationStatuses,
  type PodcastOperationItem,
  type PodcastOperationStatus,
} from "../../domain/operations/podcast-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { PodcastMonthOption } from "../../lib/integrations/google-sheets-source";
import { AnimatedSelect, type AnimatedSelectOption } from "../ui/animated-select";
import {
  DepartmentInspectorSection,
  DepartmentInspectorTab,
  DepartmentRecordInspector,
} from "./department-record-inspector";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkColumn, DepartmentWorkTable } from "./department-work-table";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

type Props = {
  /** `null` distinguishes "the source could not be reached" from a genuine zero-row result. */
  items: PodcastOperationItem[] | null;
  sourceMonth: string | null;
  lastSyncedAt: string | null;
  /**
   * The Assigned VA filter's full option list — the sheet's own
   * data-validation dropdown values unioned with whatever's actually in
   * `items` (`mergeAssignedVaOptions`, computed server-side). Never derived
   * from `items` alone here, or a VA with zero current rows would silently
   * vanish from the filter.
   */
  vaOptions: string[];
  /**
   * The month selector's server-discovered allowlist, newest first. Empty
   * (the default) when the workbook has no dated Podcast tab — the selector
   * itself simply doesn't render, rather than the caller needing to decide
   * that.
   */
  monthOptions?: PodcastMonthOption[];
  /** The resolved "YYYY-MM" currently in view — `null` only when `monthOptions` is empty. */
  selectedMonth?: string | null;
  /** Requests a different month; the caller owns navigation/URL state. Unused when `monthOptions` is empty. */
  onMonthChange?: (value: string) => void;
};

type StatusFilter = "all" | PodcastOperationStatus;

const STATUS_TONE: Record<PodcastOperationStatus, WorkflowStatusTone> = {
  in_progress: "info",
  stuck: "warning",
  completed: "positive",
  cancelled: "neutral",
};

function statusLabel(status: PodcastOperationStatus): string {
  return podcastOperationStatusLabels[status];
}

/**
 * The Podcast SEO department workflow — the first configuration of the
 * shared `Department*` components (header, status nav, toolbar, table,
 * mobile list, inspector), not a one-off page. A future department reuses
 * every import here and supplies its own columns/sections/status map.
 */
export function PodcastSeoWorkflowView({
  items,
  sourceMonth,
  lastSyncedAt,
  vaOptions,
  monthOptions = [],
  selectedMonth = null,
  onMonthChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [vaFilter, setVaFilter] = useState("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Render-phase reset (the same pattern `DepartmentRecordInspector` uses to
  // adopt a changed prop, not an effect): a genuine month change is the one
  // case these filters and the open inspector must NOT survive, since a
  // stale VA/package value from the old month's option list would otherwise
  // silently show zero rows with no indication why. A same-month background
  // refresh (live-sync) never changes `sourceMonth`, so it never trips this.
  const [lastSeenSourceMonth, setLastSeenSourceMonth] = useState(sourceMonth);
  if (sourceMonth !== lastSeenSourceMonth) {
    setLastSeenSourceMonth(sourceMonth);
    setSearch("");
    setStatusFilter("all");
    setVaFilter("all");
    setPackageFilter("all");
    setSelectedItemId(null);
  }

  const packageOptions = useMemo(() => distinctSorted(items ?? [], (item) => item.workLabel), [items]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: items?.length ?? 0,
      in_progress: 0,
      stuck: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const item of items ?? []) counts[item.normalizedStatus] += 1;
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.normalizedStatus !== statusFilter) return false;
      if (vaFilter !== "all" && (item.assignedVa ?? "") !== vaFilter) return false;
      if (packageFilter !== "all" && (item.workLabel ?? "") !== packageFilter) return false;
      if (!needle) return true;
      // `rawSeoPackage` sits alongside the (possibly abbreviated) `workLabel` so shortening
      // "SEO Success Blueprint" to "SBP" for display never makes the original phrase unsearchable.
      const haystack = [
        item.clientName,
        item.primaryKeyword,
        item.city,
        item.orderNumber,
        item.workLabel,
        item.rawSeoPackage,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, search, statusFilter, vaFilter, packageFilter]);

  // Re-selecting from `items` (not `filteredItems`) on every render is what lets a background
  // refresh update an open inspector in place — a changed status/field on the same id flows
  // straight through, and a row that vanished from the source simply closes the inspector.
  const selectedItem = items?.find((item) => item.id === selectedItemId) ?? null;

  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== "all" || vaFilter !== "all" || packageFilter !== "all";

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setVaFilter("all");
    setPackageFilter("all");
  }

  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: statusCounts.all },
    ...podcastOperationStatuses.map((status) => ({
      value: status,
      label: statusLabel(status),
      count: statusCounts[status],
    })),
  ];

  const columns: DepartmentWorkColumn<PodcastOperationItem>[] = [
    {
      key: "client",
      header: "Client",
      width: "24%",
      render: (item) => formatCleanDomain(item.clientName),
      title: (item) => item.clientName,
    },
    {
      key: "work",
      header: "Work",
      width: "13%",
      render: (item) => item.workLabel ?? "—",
    },
    {
      key: "target",
      header: "SEO Target",
      width: "23%",
      render: (item) => seoTargetLabel(item) || "—",
      title: (item) => seoTargetLabel(item) || undefined,
    },
    {
      key: "assigned",
      header: "Assigned",
      width: "13%",
      render: (item) => item.assignedVa ?? "—",
    },
    {
      key: "status",
      header: "Status",
      width: "15%",
      render: (item) => <WorkflowStatus label={statusLabel(item.normalizedStatus)} tone={STATUS_TONE[item.normalizedStatus]} />,
    },
    {
      key: "podcast",
      header: "Podcast",
      width: "12%",
      align: "center",
      hideOnTablet: true,
      render: (item) =>
        item.podcastUrl ? (
          <span onClick={(event) => event.stopPropagation()}>
            <DepartmentResourceLink
              href={item.podcastUrl}
              label="View Output"
              icon={<Mic aria-hidden="true" size={12} />}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </span>
        ) : (
          <span className="dept-empty-cell">Not available</span>
        ),
    },
  ];

  return (
    <div className="dept-workflow">
      <DepartmentWorkflowHeader title="Podcast SEO" />

      {items === null ? (
        <div className="dept-source-unavailable" role="alert">
          <strong>Podcast source unavailable.</strong>
          <p>The Podcast SEO workflow could not be reached right now. Try again shortly.</p>
        </div>
      ) : (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search clients, keywords, cities, orders…"
            searchAriaLabel="Search Podcast SEO work"
            selects={[
              {
                allLabel: "All VAs",
                ariaLabel: "Filter by assigned VA",
                value: vaFilter,
                options: vaOptions,
                onChange: setVaFilter,
                size: "compact",
              },
            ]}
            secondaryFilters={[
              {
                key: "package",
                label: "Package",
                allLabel: "All Packages",
                ariaLabel: "Filter by SEO package",
                value: packageFilter,
                options: packageOptions,
                onChange: setPackageFilter,
              },
            ]}
            trailingSelects={[
              {
                allLabel: "All Statuses",
                ariaLabel: "Filter by status",
                value: statusFilter,
                options: [],
                onChange: (value) => setStatusFilter(value as StatusFilter),
                countedOptions: statusSelectOptions,
              },
            ]}
            trailingControl={
              monthOptions.length > 0 ? (
                <AnimatedSelect
                  name="podcast-seo-month"
                  label="Month"
                  menuLabel="Select month"
                  value={selectedMonth ?? monthOptions[0]!.value}
                  onChange={onMonthChange ?? (() => {})}
                  options={monthOptions.map((option) => ({ value: option.value, label: option.label }))}
                />
              ) : null
            }
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />

          <div
            key={`${vaFilter}|${packageFilter}`}
            className="dept-filter-results"
          >
            {filteredItems.length === 0 ? (
              <p className="dept-empty">No Podcast work matches these filters.</p>
            ) : (
              <>
                <DepartmentWorkTable
                  columns={columns}
                  rows={filteredItems}
                  selectedRowId={selectedItemId}
                  onSelectRow={(item) => setSelectedItemId(item.id)}
                  getRowLabel={(item) => `Open ${formatCleanDomain(item.clientName)}`}
                />
                <DepartmentWorkListMobile
                rows={filteredItems}
                onSelectRow={(item) => setSelectedItemId(item.id)}
                renderTitle={(item) => formatCleanDomain(item.clientName)}
                renderStatus={(item) => (
                  <WorkflowStatus label={statusLabel(item.normalizedStatus)} tone={STATUS_TONE[item.normalizedStatus]} />
                )}
                renderDetailLine={(item) => [item.workLabel, seoTargetLabel(item)].filter(Boolean).join(" · ") || "—"}
                renderMetaLeft={(item) => item.assignedVa ?? "Unassigned"}
                renderMetaRight={(item) => (item.podcastUrl ? "Output available" : "No output yet")}
                getRowLabel={(item) => `Open ${formatCleanDomain(item.clientName)}`}
                />
              </>
            )}
          </div>
        </>
      )}

      <DepartmentRecordInspector
        open={selectedItem !== null}
        header={selectedItem ? <InspectorHeader item={selectedItem} /> : null}
        tabs={selectedItem ? buildInspectorTabs(selectedItem, lastSyncedAt) : []}
        onClose={() => setSelectedItemId(null)}
      />
    </div>
  );
}

function seoTargetLabel(item: PodcastOperationItem): string {
  return [item.primaryKeyword, item.city].filter(Boolean).join(" · ");
}

function InspectorHeader({ item }: { item: PodcastOperationItem }) {
  return (
    <div className="dept-inspector-identity">
      <strong>{formatCleanDomain(item.clientName)}</strong>
      <WorkflowStatus label={statusLabel(item.normalizedStatus)} tone={STATUS_TONE[item.normalizedStatus]} />
      <DepartmentResourceLink href={item.clientName} label="Open website" />
    </div>
  );
}

function buildInspectorTabs(
  item: PodcastOperationItem,
  lastSyncedAt: string | null,
): DepartmentInspectorTab[] {
  const resources: { label: string; href: string; actionLabel: string; icon: ReactNode }[] = [];
  if (item.loginUrl) {
    resources.push({ label: "Login document", href: item.loginUrl, actionLabel: "Open", icon: <KeyRound aria-hidden="true" size={13} /> });
  }
  if (item.promptSopUrl) {
    resources.push({ label: "Prompt / SOP", href: item.promptSopUrl, actionLabel: "Open", icon: <FileText aria-hidden="true" size={13} /> });
  }
  if (item.podcastUrl) {
    resources.push({ label: "Output", href: item.podcastUrl, actionLabel: "View Output", icon: <Mic aria-hidden="true" size={13} /> });
  }

  const workSections: DepartmentInspectorSection[] = [
    {
      fields: [
        { label: "Work", value: item.workLabel ?? "—" },
        { label: "Primary keyword", value: item.primaryKeyword ?? "—" },
        { label: "Location", value: item.city ?? "—" },
      ],
    },
  ];
  if (item.notes) {
    workSections.push({ title: "Notes", content: <p className="dept-inspector-notes">{item.notes}</p> });
  }

  return [
    {
      id: "overview",
      label: "Overview",
      sections: [
        {
          // Status itself is deliberately not repeated here — the header pill just
          // above the tabs (visible regardless of active tab) already carries it.
          fields: [
            { label: "Email", value: item.email ?? "—" },
            { label: "Order #", value: item.orderNumber ?? "—" },
            { label: "Assigned VA", value: item.assignedVa ?? "Unassigned" },
          ],
        },
      ],
    },
    {
      id: "work",
      label: "Work",
      sections: workSections,
    },
    {
      id: "resources",
      label: "Resources",
      sections: [
        {
          content:
            resources.length > 0 ? (
              <div className="dept-resource-list">
                {resources.map((resource) => (
                  <div key={resource.label} className="dept-resource-row">
                    <span>{resource.label}</span>
                    <DepartmentResourceLink href={resource.href} label={resource.actionLabel} icon={resource.icon} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="dept-empty-resources">No resource links on this record.</p>
            ),
        },
      ],
    },
    {
      id: "source",
      label: "Source",
      sections: [
        {
          fields: [
            { label: "Sheet tab", value: item.sourceMonth },
            { label: "Access", value: "Read only" },
            { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
          ],
        },
      ],
    },
  ];
}

function distinctSorted(
  items: readonly PodcastOperationItem[],
  pick: (item: PodcastOperationItem) => string | null,
): string[] {
  const values = new Set<string>();
  for (const item of items) {
    const value = pick(item);
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
