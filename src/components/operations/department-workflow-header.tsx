import type { ReactNode } from "react";

/**
 * The compact header every department workflow page opens with:
 *
 *   Content                             53 records
 *
 * One title, one optional count — nothing else, unless a department supplies
 * `trailing`. Source, read-only state, and last synced are technical/
 * debugging detail, not something a viewer needs to scan past on every
 * visit, so they live in the record inspector's Source tab instead of
 * cluttering this header. `count`/`countLabel` are omitted entirely by
 * Podcast SEO, whose own status nav already leads with "All N" — showing the
 * same number twice was the redundancy this option removes; every other
 * department keeps passing both, unaffected.
 */
export function DepartmentWorkflowHeader({
  title,
  count,
  countLabel,
  trailing,
}: {
  title: string;
  count?: number;
  countLabel?: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="dept-header">
      <div className="dept-header-title-group">
        <h2 className="dept-header-title">{title}</h2>
        {count !== undefined && countLabel ? (
          <p className="dept-header-count">
            {count} {countLabel}
          </p>
        ) : null}
      </div>
      {trailing ? <div className="dept-header-trailing">{trailing}</div> : null}
    </header>
  );
}
