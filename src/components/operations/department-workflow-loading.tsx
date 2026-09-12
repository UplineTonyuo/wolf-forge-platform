const rows = Array.from({ length: 5 }, (_, index) => index);

export function DepartmentWorkflowLoading() {
  return (
    <section
      className="dept-workflow-skeleton"
      role="status"
      aria-label="Loading department workflow"
      aria-busy="true"
    >
      <header>
        <span className="dept-workflow-skeleton-back" />
        <span className="dept-workflow-skeleton-title" />
      </header>
      <div className="dept-workflow-skeleton-toolbar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="dept-workflow-skeleton-list" aria-hidden="true">
        <div className="dept-workflow-skeleton-list-head" />
        {rows.map((row) => (
          <div className="dept-workflow-skeleton-row" key={row}>
            <span />
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </section>
  );
}
