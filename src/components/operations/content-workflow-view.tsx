"use client";

import { FileText, KeyRound } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  contentOperationStatusLabels,
  contentOperationStatuses,
  type ContentOperationItem,
  type ContentOperationStatus,
} from "../../domain/operations/content-workflow";
import { formatCleanDomain, formatDateTime } from "../../lib/format";
import type { AnimatedSelectOption } from "../ui/animated-select";
import {
  DepartmentRecordInspector,
  type DepartmentInspectorTab,
} from "./department-record-inspector";
import { DepartmentConnectionState } from "./department-connection-state";
import { DepartmentResourceLink } from "./department-resource-link";
import { DepartmentWorkTable, type DepartmentWorkColumn } from "./department-work-table";
import { DepartmentWorkListMobile } from "./department-work-list-mobile";
import { DepartmentWorkflowHeader } from "./department-workflow-header";
import { DepartmentWorkflowToolbar } from "./department-workflow-toolbar";
import { WorkflowStatus, type WorkflowStatusTone } from "./workflow-status";

export type ContentWorkflowViewState = "ready" | "unconfigured" | "error";

type Props = {
  state: ContentWorkflowViewState;
  items: ContentOperationItem[];
  sourceTab: string | null;
  lastSyncedAt: string | null;
};

type StatusFilter = "all" | ContentOperationStatus;
type SortOption = "all" | "Website A–Z" | "Order # A–Z" | "Status";

const STATUS_TONE: Record<ContentOperationStatus, WorkflowStatusTone> = {
  in_progress: "info",
  stuck: "warning",
  completed: "positive",
  cancelled: "neutral",
};

const STATUS_SORT_ORDER: Record<ContentOperationStatus, number> = {
  stuck: 0,
  in_progress: 1,
  completed: 2,
  cancelled: 3,
};

const SORT_OPTIONS: readonly Exclude<SortOption, "all">[] = ["Website A–Z", "Order # A–Z", "Status"];

/** Single-line ellipsis for the free-text table columns (Website, SEO Package, Content Target) — real source
 * values run up to ~55 characters ("Platinum SEO Success Blueprint (100 Targeted Keywords)") or combine
 * keyword + city into one cell ("Wood floor installation service, hardwood floor installation · Firestone");
 * without this, a `<td>`'s default text wrapping grows that one row taller than its neighbors instead of
 * overflowing sideways. Matches the same fix already applied to the other Operations department views. */
function ClampText({ value }: { value: string }) {
  return <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>;
}

export function ContentWorkflowView({ state, items, sourceTab, lastSyncedAt }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [sort, setSort] = useState<SortOption>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const packageOptions = useMemo(() => distinctSorted(items, (item) => item.seoPackage), [items]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: items.length,
      in_progress: 0,
      stuck: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const item of items) counts[item.normalizedStatus] += 1;
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (statusFilter !== "all" && item.normalizedStatus !== statusFilter) return false;
      if (packageFilter !== "all" && (item.seoPackage ?? "") !== packageFilter) return false;
      if (!needle) return true;
      return [
        item.website,
        item.email,
        item.orderNumber,
        item.seoPackage,
        item.primaryKeyword,
        item.city,
        item.blogContent,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });

    if (sort === "all") return filtered;
    return [...filtered].sort((left, right) => {
      if (sort === "Website A–Z") {
        return formatCleanDomain(left.website).localeCompare(formatCleanDomain(right.website));
      }
      if (sort === "Order # A–Z") {
        return (left.orderNumber ?? "").localeCompare(right.orderNumber ?? "", undefined, {
          numeric: true,
        });
      }
      return STATUS_SORT_ORDER[left.normalizedStatus] - STATUS_SORT_ORDER[right.normalizedStatus];
    });
  }, [items, packageFilter, search, sort, statusFilter]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== "all" || packageFilter !== "all" || sort !== "all";

  const statusSelectOptions: AnimatedSelectOption[] = [
    { value: "all", label: "All Statuses", count: statusCounts.all },
    ...contentOperationStatuses.map((status) => ({
      value: status,
      label: contentOperationStatusLabels[status],
      count: statusCounts[status],
    })),
  ];

  const columns: DepartmentWorkColumn<ContentOperationItem>[] = [
    {
      key: "website",
      header: "Website",
      width: "24%",
      render: (item) => <ClampText value={formatCleanDomain(item.website)} />,
      title: (item) => item.website,
    },
    {
      key: "package",
      header: "SEO Package",
      width: "19%",
      render: (item) => <ClampText value={item.seoPackage ?? "—"} />,
      title: (item) => item.seoPackage ?? undefined,
    },
    {
      key: "target",
      header: "Content Target",
      width: "24%",
      render: (item) => <ClampText value={contentTarget(item) || "—"} />,
      title: (item) => contentTarget(item) || undefined,
    },
    {
      key: "order",
      header: "Order #",
      width: "9%",
      render: (item) => item.orderNumber ?? "—",
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (item) => <ContentStatus item={item} />,
    },
    {
      key: "output",
      header: "Blog Content",
      width: "10%",
      align: "center",
      hideOnTablet: true,
      render: (item) => <BlogContentCell item={item} />,
    },
  ];

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setPackageFilter("all");
    setSort("all");
  }

  return (
    <div className="dept-workflow">
      <DepartmentWorkflowHeader
        title="Content"
        count={state === "ready" ? items.length : undefined}
        countLabel="records"
      />

      {state === "unconfigured" ? (
        <DepartmentConnectionState
          departmentName="Content"
          headingId="content-connection-title"
          icon={<FileText aria-hidden="true" size={15} strokeWidth={1.8} />}
        />
      ) : null}

      {state === "error" ? (
        <div className="dept-source-unavailable" role="alert">
          <strong>Content workflow is temporarily unavailable.</strong>
          <p>The workflow could not be refreshed right now. Try again shortly.</p>
        </div>
      ) : null}

      {state === "ready" ? (
        <>
          <DepartmentWorkflowToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search websites, keywords, cities, orders…"
            searchAriaLabel="Search Content work"
            selects={[
              {
                allLabel: "Sheet order",
                ariaLabel: "Sort Content work",
                value: sort,
                options: SORT_OPTIONS,
                onChange: (value) => setSort(isSortOption(value) ? value : "all"),
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
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />

          <div key={`${packageFilter}|${sort}`} className="dept-filter-results">
            {visibleItems.length === 0 ? (
              <div className="dept-empty" role="status">
                {items.length === 0 && !hasActiveFilters
                  ? "No Content workflow records were found."
                  : "No Content work matches these filters."}
              </div>
            ) : (
              <>
                <DepartmentWorkTable
                  columns={columns}
                  rows={visibleItems}
                  selectedRowId={selectedItemId}
                  onSelectRow={(item) => setSelectedItemId(item.id)}
                  getRowLabel={(item) => `Open ${formatCleanDomain(item.website)}`}
                />
                <DepartmentWorkListMobile<ContentOperationItem>
                  rows={visibleItems}
                  onSelectRow={(item) => setSelectedItemId(item.id)}
                  renderTitle={(item) => formatCleanDomain(item.website)}
                  renderStatus={(item) => <ContentStatus item={item} />}
                  renderDetailLine={(item) => [item.seoPackage, contentTarget(item)].filter(Boolean).join(" · ") || "—"}
                  renderMetaLeft={(item) => item.orderNumber ?? "No order number"}
                  renderMetaRight={(item) => (item.blogContent ? "Content recorded" : "No content yet")}
                  renderAction={(item) => <BlogContentCell item={item} />}
                  getRowLabel={(item) => `Open ${formatCleanDomain(item.website)}`}
                />
              </>
            )}
          </div>
        </>
      ) : null}

      <DepartmentRecordInspector
        open={selectedItem !== null}
        header={selectedItem ? <InspectorHeader item={selectedItem} /> : null}
        tabs={selectedItem ? buildInspectorTabs(selectedItem, sourceTab, lastSyncedAt) : []}
        onClose={() => setSelectedItemId(null)}
      />
    </div>
  );
}

function ContentStatus({ item }: { item: ContentOperationItem }) {
  return (
    <WorkflowStatus
      label={contentOperationStatusLabels[item.normalizedStatus]}
      tone={STATUS_TONE[item.normalizedStatus]}
    />
  );
}

function BlogContentCell({ item }: { item: ContentOperationItem }) {
  if (!item.blogContent) return <span className="dept-empty-cell">Not available</span>;
  if (!isHttpUrl(item.blogContent)) {
    return <span className="dept-recorded-value" title={item.blogContent}>Recorded</span>;
  }
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <DepartmentResourceLink
        href={item.blogContent}
        label="Open content"
        icon={<FileText aria-hidden="true" size={12} />}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </span>
  );
}

function InspectorHeader({ item }: { item: ContentOperationItem }) {
  return (
    <div className="dept-inspector-identity">
      <strong>{formatCleanDomain(item.website)}</strong>
      <ContentStatus item={item} />
      <DepartmentResourceLink href={item.website} label="Open website" />
    </div>
  );
}

function buildInspectorTabs(
  item: ContentOperationItem,
  sourceTab: string | null,
  lastSyncedAt: string | null,
): DepartmentInspectorTab[] {
  const resources: { label: string; href: string; actionLabel: string; icon: ReactNode }[] = [];
  if (item.loginUrl) {
    resources.push({ label: "Login document", href: item.loginUrl, actionLabel: "Open", icon: <KeyRound aria-hidden="true" size={13} /> });
  }
  if (item.promptSopUrl) {
    resources.push({ label: "Prompt / SOP", href: item.promptSopUrl, actionLabel: "Open", icon: <FileText aria-hidden="true" size={13} /> });
  }
  if (item.blogContent && isHttpUrl(item.blogContent)) {
    resources.push({ label: "4 Blog Content", href: item.blogContent, actionLabel: "Open content", icon: <FileText aria-hidden="true" size={13} /> });
  }

  return [
    {
      id: "overview",
      label: "Overview",
      sections: [{
        fields: [
          { label: "Email", value: item.email ?? "—" },
          { label: "Order #", value: item.orderNumber ?? "—" },
          { label: "SEO package", value: item.seoPackage ?? "—" },
        ],
      }],
    },
    {
      id: "content",
      label: "Content",
      sections: [{
        fields: [
          { label: "Primary keyword", value: item.primaryKeyword ?? "—" },
          { label: "City", value: item.city ?? "—" },
          {
            label: "4 Blog Content",
            value: item.blogContent && !isHttpUrl(item.blogContent) ? item.blogContent : item.blogContent ? "Available" : "—",
          },
        ],
      }],
    },
    {
      id: "resources",
      label: "Resources",
      sections: [{
        content: resources.length > 0 ? (
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
      }],
    },
    {
      id: "source",
      label: "Source",
      sections: [{
        fields: [
          { label: "Sheet tab", value: sourceTab ?? item.sourceTab },
          { label: "Section", value: item.sourceSection },
          { label: "Access", value: "Read only" },
          { label: "Last synced", value: lastSyncedAt ? formatDateTime(lastSyncedAt) : "—" },
        ],
      }],
    },
  ];
}

function contentTarget(item: ContentOperationItem): string {
  return [item.primaryKeyword, item.city].filter(Boolean).join(" · ");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSortOption(value: string): value is SortOption {
  return value === "all" || SORT_OPTIONS.includes(value as Exclude<SortOption, "all">);
}

function distinctSorted(
  items: readonly ContentOperationItem[],
  pick: (item: ContentOperationItem) => string | null,
): string[] {
  const values = new Set<string>();
  for (const item of items) {
    const value = pick(item);
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
