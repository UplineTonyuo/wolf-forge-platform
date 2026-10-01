const NEEDS_ATTENTION_GROUPS = [
  { width: 64, rows: 3 },
  { width: 88, rows: 2 },
  { width: 128, rows: 2 },
];

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="attention-rows">
      {Array.from({ length: count }, (_, row) => (
        <div className="attention-row" key={row}>
          <div className="attention-row-main">
            <span className="tasks-skeleton-bar tasks-skeleton-bar-title" />
            <span className="tasks-skeleton-bar tasks-skeleton-bar-sub" />
          </div>
          <div className="attention-row-meta">
            <span className="tasks-skeleton-bar tasks-skeleton-bar-status" />
            <span className="tasks-skeleton-bar tasks-skeleton-bar-date" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Mirrors ToDoPage's actual structure (two `.attention-title` dividers, the
 * "Assigned to me" section, then three Order-based groups) using the SAME
 * `.attention-stack` / `.attention-title` / `.attention-section` /
 * `.section-heading` / `.attention-rows` / `.attention-row` classes the
 * resolved page renders, so this skeleton occupies the real page's geometry
 * instead of an approximate mock. A prior version used its own skeleton-only
 * wrapper with no dividers and landed ~170px shorter, which read as a layout
 * jump on resolve. Section labels are drawn as bars too: a loading state shows
 * shapes only, never text that reads as loaded content.
 */
export function TasksLoading() {
  return (
    <div className="attention-stack" role="status" aria-label="Loading tasks" aria-busy="true">
      <div className="attention-title">
        <span />
        <div className="tasks-skeleton-bar tasks-skeleton-bar-label" style={{ width: 78 }} />
      </div>
      <section className="attention-section">
        <div className="section-heading">
          <div className="tasks-skeleton-bar tasks-skeleton-bar-heading" style={{ width: 104 }} />
          <span />
        </div>
        <SkeletonRows count={1} />
      </section>

      <div className="attention-title">
        <span />
        <div className="tasks-skeleton-bar tasks-skeleton-bar-label" style={{ width: 112 }} />
      </div>
      {NEEDS_ATTENTION_GROUPS.map((group) => (
        <section className="attention-section" key={group.width}>
          <div className="section-heading">
            <div className="tasks-skeleton-bar tasks-skeleton-bar-heading" style={{ width: group.width }} />
            <span />
          </div>
          <SkeletonRows count={group.rows} />
        </section>
      ))}
    </div>
  );
}
