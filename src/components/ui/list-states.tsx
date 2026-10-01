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

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-skeleton" aria-label="Loading" role="status">
      <div className="skeleton-line skeleton-heading" />
      {Array.from({ length: rows }, (_, index) => <div className="skeleton-line" key={index} />)}
    </div>
  );
}
