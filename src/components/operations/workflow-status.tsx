/**
 * The one status badge every department workflow surface uses. Deliberately
 * generic over "tone" (`info`/`warning`/`positive`/`neutral`) rather than a
 * department's own status vocabulary — Podcast SEO's four canonical
 * statuses map onto these tones, and a future department with a different
 * status set reuses this component by choosing its own mapping, not by
 * copying it.
 *
 * Text-first, restrained color: the label is always visible text, and a
 * small leading dot carries the tone redundantly (shape *and* text, never
 * color alone), so status reads correctly on a screen reader, in
 * grayscale, and for a color-blind viewer.
 */

export type WorkflowStatusTone = "info" | "warning" | "positive" | "neutral";

export function WorkflowStatus({ label, tone }: { label: string; tone: WorkflowStatusTone }) {
  return (
    <span className={`workflow-status workflow-status-${tone}`}>
      <span className="workflow-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
