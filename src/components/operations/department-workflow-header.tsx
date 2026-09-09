import type { ReactNode } from "react";

/**
 * The compact header every department workflow page opens with:
 *
 *   Podcast SEO                         [ August 2026 v ]
 *   53 workflows
 *
 * One title, one count — nothing else, unless a department supplies
 * `trailing` (e.g. Podcast SEO's month selector). Source, read-only state,
 * and last synced are technical/debugging detail, not something a viewer
 * needs to scan past on every visit, so they live in the record inspector's
 * Source tab instead of cluttering this header. `trailing` is `undefined` for
 * every other department today, so this stays a no-op change for them.
 */
export function DepartmentWorkflowHeader({
  title,
  count,
  countLabel,
  trailing,
}: {
  title: string;
  count: number;
  countLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="dept-header">
      <div className="dept-header-title-group">
        <h2 className="dept-header-title">{title}</h2>
        <p className="dept-header-count">
          {count} {countLabel}
        </p>
      </div>
      {trailing ? <div className="dept-header-trailing">{trailing}</div> : null}
    </header>
  );
}
