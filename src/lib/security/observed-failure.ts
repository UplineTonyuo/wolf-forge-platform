import "server-only";

import {
  toClientSafeError,
  type ApplicationErrorCode,
  type ClientSafeError,
} from "../errors/application-error";
import {
  classifyApplicationErrorCode,
  type FailureClass,
} from "../../domain/security/error-classification";
import type { SecurityEventCode } from "../../domain/security/event-codes";
import { currentCorrelationId } from "./request-correlation";
import { recordSecurityEvent, type ActorClass } from "./security-log";

/**
 * The failure boundary: one place that turns a thrown error into (a) the
 * client-safe result the caller already returns and (b) at most one correctly
 * classified security event.
 *
 * ## One event per user-visible failure
 *
 * The signal is emitted HERE — at the action or route boundary — rather than
 * deep in `mapDatabaseError`, for two reasons. The boundary is the only place
 * that knows which ACTION failed, and it is the only place that can `await` the
 * request's correlation id. A signal emitted in the repository would be a
 * second, correlation-less line describing the same failure.
 *
 * ## Silence is a classification
 *
 * An EXPECTED domain failure — a validation error, a not-found, a conflict —
 * emits nothing at all by default. That is not an omission: an error stream in
 * which mistyped forms outnumber real failures a thousand to one is an error
 * stream nobody reads. Callers that genuinely want an expected refusal recorded
 * (an insufficient balance, say, which is economically interesting even though
 * it is not a defect) pass `expectedEvent` explicitly.
 *
 * ## What is never logged
 *
 * The error itself never reaches the record. `metadata.detail` carries the
 * error's message only for SYSTEM failures, and only after `redactMetadata` has
 * scrubbed and truncated it — a raw Postgres message can name a column value.
 * The client-safe message returned to the caller is unchanged in every case, so
 * wiring this in changes nothing a user can observe.
 */
export interface ObservedFailureInput {
  /**
   * Stable slug for the operation, e.g. `store.purchase`, `profile.avatar`.
   * Lands in `metadata.action`, which is what makes "which surface is being
   * hammered" answerable without naming a rate-limit bucket.
   */
  readonly action: string;
  readonly actorId?: string | null;
  readonly actorClass?: ActorClass;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  /** Emitted for `expected` failures. Omit to record nothing for those. */
  readonly expectedEvent?: SecurityEventCode;
  /** Overrides `system.database.failed` / `system.unexpected_error`. */
  readonly systemEvent?: SecurityEventCode;
  /** Overrides `abuse.rate_limited` for a throttle refusal. */
  readonly rateLimitEvent?: SecurityEventCode;
  /** Overrides `authorization.capability.denied` for a permission refusal. */
  readonly deniedEvent?: SecurityEventCode;
  /** Extra safe context. Passes through `redactMetadata` like everything else. */
  readonly metadata?: Record<string, unknown>;
}

function eventForFailure(
  code: ApplicationErrorCode,
  failureClass: FailureClass,
  input: ObservedFailureInput,
): SecurityEventCode | null {
  if (failureClass === "expected") return input.expectedEvent ?? null;

  if (failureClass === "security_signal") {
    return code === "RATE_LIMITED"
      ? (input.rateLimitEvent ?? "abuse.rate_limited")
      : (input.deniedEvent ?? "authorization.capability.denied");
  }

  return input.systemEvent ?? (code === "DATABASE_ERROR" ? "system.database.failed" : "system.unexpected_error");
}

function outcomeFor(failureClass: FailureClass): "denied" | "failed" {
  return failureClass === "system_error" ? "failed" : "denied";
}

/**
 * The message of an unexpected error, for the server log only.
 *
 * Included solely for `system_error`: those are the failures where knowing
 * "duplicate key value violates unique constraint …" versus "connection
 * terminated" is the difference between a five-minute fix and an afternoon.
 * `redactMetadata` scrubs secret and PII shapes out of it and caps it at 200
 * characters before it is written.
 */
function systemDetail(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error_name: typeof error };

  const cause = (error as { cause?: unknown }).cause as { code?: unknown } | undefined;
  const sqlstate = typeof cause?.code === "string" && /^[A-Za-z0-9]{1,10}$/.test(cause.code)
    ? cause.code
    : undefined;

  return {
    error_name: error.name,
    detail: error.message,
    ...(sqlstate ? { sqlstate } : {}),
  };
}

/**
 * Records the failure and returns the client-safe error the caller should
 * surface. Never throws: on any internal problem it still returns a valid
 * client-safe error.
 */
export async function observeActionFailure(
  error: unknown,
  input: ObservedFailureInput,
): Promise<ClientSafeError> {
  const safe = toClientSafeError(error);

  try {
    const failureClass = classifyApplicationErrorCode(safe.code);
    const event = eventForFailure(safe.code, failureClass, input);
    if (!event) return safe;

    recordSecurityEvent({
      event,
      correlationId: await currentCorrelationId(),
      actorId: input.actorId,
      actorClass: input.actorClass,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: outcomeFor(failureClass),
      failureClass,
      metadata: {
        action: input.action,
        error_code: safe.code,
        ...(failureClass === "system_error" ? systemDetail(error) : {}),
        ...input.metadata,
      },
    });
  } catch {
    /* Observability never changes the outcome of the operation it observes. */
  }

  return safe;
}
