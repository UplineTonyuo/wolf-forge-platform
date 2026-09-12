const GROUPS = [{ rows: 2 }, { rows: 3 }, { rows: 2 }] as const;

export function TasksLoading() {
  return (
    <div className="tasks-skeleton" role="status" aria-label="Loading tasks" aria-busy="true">
      {GROUPS.map((group, index) => (
        <div className="tasks-skeleton-group" key={index}>
          <div className="tasks-skeleton-heading">
            <span className="tasks-skeleton-heading-label" />
            <span className="tasks-skeleton-heading-count" />
          </div>
          <div className="tasks-skeleton-rows">
            {Array.from({ length: group.rows }, (_, row) => (
              <div className="tasks-skeleton-row" key={row}>
                <span className="tasks-skeleton-row-main">
                  <span className="tasks-skeleton-row-title" />
                  <span className="tasks-skeleton-row-sub" />
                </span>
                <span className="tasks-skeleton-row-meta">
                  <span className="tasks-skeleton-row-status" />
                  <span className="tasks-skeleton-row-date" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
