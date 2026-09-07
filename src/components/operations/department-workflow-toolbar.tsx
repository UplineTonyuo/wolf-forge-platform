import { Search } from "lucide-react";
import { AnimatedSelect } from "../ui/animated-select";

export type DepartmentToolbarSelect = {
  /** Also used as the "no filter" option's own visible label, e.g. "All VAs" — no separate detached label sits above the control. */
  allLabel: string;
  ariaLabel: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  size?: "compact" | "wide";
};

/**
 * One toolbar row: search plus any number of secondary selects, and a
 * restrained text "Clear filters" action that only exists when a filter is
 * actually active. Each select's own default option IS its label ("All
 * VAs", "All Packages") rather than a tiny uppercase caption floating above
 * a bare "All" — one fewer detached label, same information.
 */
export function DepartmentWorkflowToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  selects,
  hasActiveFilters,
  onClearFilters,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  selects: readonly DepartmentToolbarSelect[];
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
        <div
          className={[
            "dept-toolbar-select",
            select.size === "wide"
              ? "dept-toolbar-select-wide"
              : "dept-toolbar-select-compact",
          ].join(" ")}
          key={select.ariaLabel}
        >
          <AnimatedSelect
            name={select.ariaLabel}
            label={select.ariaLabel}
            menuLabel={select.ariaLabel}
            value={select.value}
            onChange={select.onChange}
            options={[
              { value: "all", label: select.allLabel },
              ...select.options.map((option) => ({ value: option, label: option })),
            ]}
          />
        </div>
      ))}

      {hasActiveFilters ? (
        <button type="button" className="dept-clear-filters" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
