import "server-only";

import { PermissionDeniedError } from "../errors/application-error";
import { currentCorrelationId } from "./request-correlation";
import { recordSecurityAuditEvent } from "./security-audit-log";

/**
 * Records a Team route refusal that the database, not the route, decided.
 *
 * The Team synchronization routes resolve only a verified actor — the profile,
 * role, permission and module reads that getInternalContext() performs decide
 * nothing here and cost a wave of round trips on the latency path. That change
 * would otherwise have taken an audit event with it: previously a client
 * account reaching an internal surface was recorded when resolveInternalUser()
 * came back empty.
 *
 * So the event is recorded from the other end instead. private.require_team_actor()
 * raises 42501 for any account that is not an active internal member holding
 * team_messages.use, which surfaces here as PermissionDeniedError, and that IS
 * the cross-surface attempt worth keeping.
 *
 * Nothing about the message itself is recorded — no body, no conversation
 * title, no draft. Only who was refused, on which surface.
 */
export async function recordTeamRouteRefusal(input: {
  error: unknown;
  actorId: string;
  surface: "team.live" | "team.sync" | "team.typing";
}): Promise<void> {
  if (!(input.error instanceof PermissionDeniedError)) return;

  await recordSecurityAuditEvent({
    event: "authorization.context.denied",
    correlationId: await currentCorrelationId(),
    actorId: input.actorId,
    actorClass: "internal",
    actionSlug: "team.route.read",
    outcome: "denied",
    metadata: { surface: input.surface, reason: "not_team_actor" },
  });
}
