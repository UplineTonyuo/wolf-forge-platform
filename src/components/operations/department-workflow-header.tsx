/**
 * The compact header every department workflow page opens with:
 *
 *   Podcast SEO
 *   53 workflows
 *
 * One title, one count — nothing else. Source, read-only state, and last
 * synced are technical/debugging detail, not something a viewer needs to
 * scan past on every visit, so they live in the record inspector's Source
 * tab instead of cluttering this header.
 */
export function DepartmentWorkflowHeader({
  title,
  count,
  countLabel,
}: {
  title: string;
  count: number;
  countLabel: string;
}) {
  return (
    <header className="dept-header">
      <div className="dept-header-title-group">
        <h2 className="dept-header-title">{title}</h2>
        <p className="dept-header-count">
          {count} {countLabel}
        </p>
      </div>
    </header>
  );
}
