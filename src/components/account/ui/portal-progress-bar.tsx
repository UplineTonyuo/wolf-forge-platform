/**
 * Delivery progress, or an honest absence of it.
 *
 * The percentage is only ever the real ratio of completed delivery tasks to
 * total delivery tasks, computed in domain/orders/client-projections.ts. A
 * project with no tasks recorded has no measurable progress, so this renders
 * nothing at all rather than an empty bar implying "0% done".
 */
export function PortalProgressBar({
  percent,
  label,
}: {
  percent: number | null;
  label: string | null;
}) {
  if (percent === null) {
    return <span className="portal-progress-empty">Progress not tracked yet</span>;
  }

  return (
    <span
      className="portal-progress"
      role="img"
      aria-label={label ?? `${percent}% complete`}
    >
      <span className="portal-progress-track">
        <span className="portal-progress-fill" style={{ width: `${percent}%` }} />
      </span>
      <em aria-hidden="true">{percent}%</em>
    </span>
  );
}
