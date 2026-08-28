import "server-only";

import type { SecurityEventCode } from "../../domain/security/event-codes";
import { currentCorrelationId } from "../security/request-correlation";
import { recordSecurityEvent, type EventOutcome } from "../security/security-log";

/**
 * Security C2-4 observability for the four Gmail OAuth routes.
 *
 * ## What this replaces
 *
 * Every Gmail route used to funnel every failure into a `?gmail=<result>` query
 * parameter and a bare `catch {}`. That is correct for the OPERATOR — the UI
 * should not explain a provider failure — but it meant the most attack-shaped
 * events in the product left no trace at all: a mismatched OAuth `state`, a
 * `invalid_grant` on refresh, a request arriving from a foreign origin.
 *
 * ## What is never passed in
 *
 * There is no parameter here for a code, a state value, a PKCE verifier, a
 * token, a Google response body or the connected mailbox address. The redactor
 * downstream would catch most of those, but the point is that a call site
 * cannot offer them: `reason` is a fixed vocabulary chosen by the caller, not
 * anything derived from the request or the provider.
 *
 * The connected Google account's email is the one identifier an operator might
 * expect to see here, and it is deliberately absent. It is the mailbox the
 * agency sends from — logging it on every refresh failure would scatter it
 * through the log drain for no investigative gain, since there is exactly one
 * Gmail connection.
 */

export type GmailRouteAction = "connect" | "callback" | "verify" | "disconnect";

function actionSlug(action: GmailRouteAction): string {
  return `integration.gmail.${action}`;
}

/** Records one Gmail provider/route outcome. */
export async function recordGmailRouteEvent(input: {
  event: SecurityEventCode;
  action: GmailRouteAction;
  reason: string;
  actorId?: string | null;
  outcome?: EventOutcome;
}): Promise<void> {
  recordSecurityEvent({
    event: input.event,
    correlationId: await currentCorrelationId(),
    actorId: input.actorId,
    actorClass: "internal",
    provider: "google",
    resourceType: "integration_connection",
    outcome: input.outcome ?? "denied",
    metadata: { action: actionSlug(input.action), reason: input.reason },
  });
}

/**
 * The `integrations.manage` gate refused an operator.
 *
 * Named as an AUTHORIZATION event rather than an integration one on purpose:
 * it belongs with every other capability denial when someone asks "what did
 * this account try to reach", not with Google's provider failures.
 */
export async function recordGmailCapabilityDenied(input: {
  action: GmailRouteAction;
  actorId?: string | null;
}): Promise<void> {
  recordSecurityEvent({
    event: "authorization.capability.denied",
    correlationId: await currentCorrelationId(),
    actorId: input.actorId,
    actorClass: "internal",
    provider: "google",
    outcome: "denied",
    metadata: { action: actionSlug(input.action), capability: "integrations.manage" },
  });
}

/**
 * A state-changing Gmail route was reached without the expected `Origin`.
 *
 * The rejected origin itself is NOT logged. It is attacker-controlled text
 * heading for a JSON log line, and knowing that the check fired is the signal —
 * the value adds nothing an investigation could act on that the request logs do
 * not already hold.
 */
export async function recordGmailOriginRejected(input: {
  action: GmailRouteAction;
  actorId?: string | null;
}): Promise<void> {
  recordSecurityEvent({
    event: "authorization.origin.rejected",
    correlationId: await currentCorrelationId(),
    actorId: input.actorId,
    actorClass: "internal",
    provider: "google",
    outcome: "denied",
    metadata: { action: actionSlug(input.action), reason: "origin_mismatch" },
  });
}
