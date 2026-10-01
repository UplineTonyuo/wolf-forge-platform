import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </section>
  );
}

export function DataError({ message = "The data could not be loaded." }: { message?: string }) {
  return (
    <div className="error-state" role="alert" aria-live="assertive">
      <strong>Unable to load this area.</strong>
      <span>{message}</span>
    </div>
  );
}

/** Generic page-shaped skeleton for internal route transitions. */
export function InternalPageSkeleton() {
  const bar = "internal-page-skeleton-bar";
  return (
    <div className="page-frame internal-page-skeleton" role="status">
      <span className="sr-only">Loading page</span>
      <div aria-hidden="true">
        <div className="page-header">
          <div>
            <span className={`${bar} internal-page-skeleton-title`} />
            <span className={`${bar} internal-page-skeleton-subtitle`} />
          </div>
        </div>
        <div className="internal-page-skeleton-cards">
          {[0, 1, 2].map((card) => (
            <div className="internal-page-skeleton-card" key={card}>
              <span className={bar} />
              <span className={bar} />
            </div>
          ))}
        </div>
        <div className="internal-page-skeleton-list">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div className="internal-page-skeleton-row" key={row}>
              <span className={bar} />
              <span className={bar} />
              <span className={bar} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-skeleton" aria-label="Loading" role="status">
      <div className="skeleton-line skeleton-heading" />
      {Array.from({ length: rows }, (_, index) => <div className="skeleton-line" key={index} />)}
    </div>
  );
}
