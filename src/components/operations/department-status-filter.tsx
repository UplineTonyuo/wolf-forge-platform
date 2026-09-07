import type { WorkflowStatusTone } from "./workflow-status";

export type DepartmentStatusFilterOption<Key extends string> = {
  key: Key;
  label: string;
  count: number;
  /** Present only for statuses worth a small notice-dot (e.g. Stuck, In Progress) — omit for calm/neutral states like Completed. */
  tone?: WorkflowStatusTone;
};

/**
 * A light text-nav treatment, not a row of heavy filled pills — replaces
 * the earlier chip design without changing what it filters. The active
 * item is marked by an underline and weight change, not a filled
 * background; a small tone dot marks only the statuses worth noticing
 * (Stuck, In Progress) so they're easier to catch without becoming warning
 * widgets. Order is intentionally NOT re-priority-sorted — it stays the
 * department's own canonical status order.
 */
export function DepartmentStatusFilter<Key extends string>({
  options,
  active,
  onChange,
}: {
  options: readonly DepartmentStatusFilterOption<Key>[];
  active: Key;
  onChange: (key: Key) => void;
}) {
  return (
    <div className="dept-status-filter" role="group" aria-label="Filter by status">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={
            active === option.key ? "dept-status-filter-item dept-status-filter-item-active" : "dept-status-filter-item"
          }
          aria-pressed={active === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.tone ? <span className={`dept-status-dot dept-status-dot-${option.tone}`} aria-hidden="true" /> : null}
          {option.label} <span className="dept-status-filter-count">{option.count}</span>
        </button>
      ))}
    </div>
  );
}
