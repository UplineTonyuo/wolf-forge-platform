import "server-only";

import type { SecurityEventCode } from "../../domain/security/event-codes";
import {
  recordSecurityAuditEvent,
} from "../security/security-audit-log";
import { currentCorrelationId } from "../security/request-correlation";

/**
 * Durable audit for the Gmail connection lifecycle (Security C2-5).
 *
 * ## Which outcomes qualify
 *
 * Only the transitions that change EXTERNAL credential state or leave it
 * ambiguous: connected, disconnected, reauthorization-required, and a failed
 * disconnect — the last because it can strand a live Google grant the UI
 * already reports as gone. Routine successes that change nothing (a verify
 * heartbeat, an access-token refresh) stay C2-4 log lines; permanent rows for
 * them would be noise.
 *
 * ## What can never be passed in
 *
 * The input type has no field for an authorization code, a state value, a PKCE
 * verifier, a token, or the mailbox address — mirroring gmail-observability.ts.
 * Provider plus actor plus outcome is the complete audit content of a
 * lifecycle transition; there is exactly one platform-level connection per
 * provider, so no finer resource identity exists to record.
 */

type GmailAuditAction = "callback" | "verify" | "disconnect";

const AUDIT_LIFECYCLE_EVENTS: Readonly<
  Partial<Record<SecurityEventCode, boolean>>
> = Object.freeze({
  "integration.gmail.connected": true,
  "integration.gmail.disconnected": true,
  "integration.gmail.reauthorization_required": true,
  "integration.gmail.disconnect_failed": true,
});

export function isGmailLifecycleAuditEvent(event: SecurityEventCode): boolean {
  return AUDIT_LIFECYCLE_EVENTS[event] === true;
}

/** Persists one Gmail lifecycle transition. Never throws. */
export async function recordGmailLifecycleAudit(input: {
  event: SecurityEventCode;
  action: GmailAuditAction;
  actorId?: string | null;
  outcome?: "succeeded" | "denied" | "failed";
}): Promise<void> {
  if (!isGmailLifecycleAuditEvent(input.event)) return;

  await recordSecurityAuditEvent({
    event: input.event,
    correlationId: await currentCorrelationId(),
    actorId: input.actorId,
    actorClass: "internal",
    provider: "google",
    outcome: input.outcome ?? "succeeded",
    actionSlug: `integration.gmail.${input.action}`,
    metadata: { lifecycle_step: input.action },
  });
}
