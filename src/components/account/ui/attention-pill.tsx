import type { AttentionTone } from "../../../domain/client-portal/attention";

/**
 * The portal's one status pill.
 *
 * Every client-facing state — project, conversation, invoice, onboarding item,
 * subscription — renders through this component, so the five tones read
 * identically wherever they appear. Colour comes from the data-tone attribute
 * in globals.css rather than from a class chosen at each call site, which is
 * what stops a sixth visual language appearing later.
 */
export function AttentionPill({
  tone,
  label,
}: {
  tone: AttentionTone;
  label: string;
}) {
  return (
    <span className="portal-attention-pill" data-tone={tone}>
      {label}
    </span>
  );
}
