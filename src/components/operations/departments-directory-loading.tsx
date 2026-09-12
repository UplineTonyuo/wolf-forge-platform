const CARDS = Array.from({ length: 8 }, (_, index) => index);

export function DepartmentsDirectoryLoading() {
  return (
    <div className="departments-skeleton" role="status" aria-label="Loading department directory" aria-busy="true">
      <div className="departments-skeleton-header">
        <span className="departments-skeleton-title" />
        <span className="departments-skeleton-summary" />
      </div>
      <div className="departments-skeleton-grid">
        {CARDS.map((card) => (
          <div className="departments-skeleton-card" key={card}>
            <span className="departments-skeleton-icon" />
            <span className="departments-skeleton-copy">
              <span className="departments-skeleton-copy-title" />
              <span className="departments-skeleton-copy-line" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
