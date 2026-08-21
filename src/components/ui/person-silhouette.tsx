/**
 * The one human-avatar fallback for the product.
 *
 * Used wherever a person has no uploaded photo — internal staff, the owner,
 * client accounts, message authors. A neutral head-and-shoulders silhouette,
 * deliberately not initials and deliberately not the Wolf Forge mark: the brand
 * is not a person, and showing it in a human slot misread as "Wolf Forge said
 * this" on ticket messages.
 *
 * Colour comes from the surrounding avatar element, so the same shape works on
 * a light wash or an inverted navy surface without a second copy.
 */
export function PersonSilhouette({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-testid="avatar-fallback"
    >
      {/* Head */}
      <circle cx="20" cy="15" r="6.6" />
      {/*
       * Shoulders. A clipped arc rather than a full rounded rectangle, so the
       * silhouette reads as a bust inside a circular frame at every size.
       */}
      <path d="M20 24.4c-6.6 0-12 4.2-12 9.4v1.6c0 .6.5 1.1 1.1 1.1h21.8c.6 0 1.1-.5 1.1-1.1v-1.6c0-5.2-5.4-9.4-12-9.4Z" />
    </svg>
  );
}
