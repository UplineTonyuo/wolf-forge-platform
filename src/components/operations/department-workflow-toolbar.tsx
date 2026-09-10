import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { AnimatedSelect, type AnimatedSelectOption } from "../ui/animated-select";
import { DepartmentToolbarFilters, type DepartmentToolbarFilterGroup } from "./department-toolbar-filters";

export type DepartmentToolbarSelect = {
  /** Also used as the "no filter" option's own visible label, e.g. "All VAs" — no separate detached label sits above the control. */
  allLabel: string;
  ariaLabel: string;
  value: string;
  options: readonly string[];
  countedOptions?: AnimatedSelectOption[];
  onChange: (value: string) => void;
  size?: "compact" | "wide";
};

/**
 * One toolbar row: search, any number of leading selects (e.g. an
 * Executive/VA filter), an optional `secondaryFilters` "Filters" control
 * (low-signal dimensions like SEO package that don't need permanent
 * toolbar space), any number of trailing selects (e.g. the All Statuses
 * dropdown), an optional non-filter `trailingControl` (e.g. the month
 * selector — a required single value, not an "All X" filter, so it doesn't
 * fit `DepartmentToolbarSelect`'s shape), and a restrained text "Clear
 * filters" action that only exists when a filter is actually active. Each
 * filter select's own default option IS its label ("All VAs", "All
 * Statuses") rather than a tiny uppercase caption floating above a bare
 * "All" — one fewer detached label, same information. `secondaryFilters`
 * and `trailingSelects` default to empty, so this stays a no-op change for
 * every caller that doesn't pass them.
 */
export function DepartmentWorkflowToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  selects,
  secondaryFilters = [],
  trailingSelects = [],
  trailingControl,
  hasActiveFilters,
  onClearFilters,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  selects: readonly DepartmentToolbarSelect[];
  /** Low-signal filter dimensions (today: SEO package) collapsed behind a single "Filters" trigger instead of a permanent select. */
  secondaryFilters?: readonly DepartmentToolbarFilterGroup[];
  /** Selects rendered after `secondaryFilters`, e.g. the All Statuses dropdown. */
  trailingSelects?: readonly DepartmentToolbarSelect[];
  trailingControl?: ReactNode;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="dept-toolbar">
      <label className="dept-search">
        <Search aria-hidden="true" size={14} />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
        />
      </label>

      {selects.map((select) => (
        <ToolbarSelect key={select.ariaLabel} select={select} />
      ))}

      {secondaryFilters.length > 0 ? <DepartmentToolbarFilters groups={secondaryFilters} /> : null}

      {trailingSelects.map((select) => (
        <ToolbarSelect key={select.ariaLabel} select={select} />
      ))}

      {trailingControl ? (
        <div className="dept-toolbar-select dept-toolbar-select-compact">{trailingControl}</div>
      ) : null}

      {hasActiveFilters ? (
        <button type="button" className="dept-clear-filters" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function ToolbarSelect({ select }: { select: DepartmentToolbarSelect }) {
  return (
    <div
      className={[
        "dept-toolbar-select",
        select.size === "wide" ? "dept-toolbar-select-wide" : "dept-toolbar-select-compact",
      ].join(" ")}
    >
      <AnimatedSelect
        name={select.ariaLabel}
        label={select.ariaLabel}
        menuLabel={select.ariaLabel}
        value={select.value}
        onChange={select.onChange}
        options={select.countedOptions ?? [
          { value: "all", label: select.allLabel },
          ...select.options.map((option) => ({ value: option, label: option })),
        ]}
      />
    </div>
  );
}
