/**
 * The durable security audit trail — pure half.
 *
 * ## What this is
 *
 * C2-4 emits one structured log line per security signal. C2-5 escalates a
 * deliberately small, selected subset of those signals into durable,
 * append-only rows (`public.security_audit_events`) so that security-sensitive
 * actions can be reconstructed long after the log drain has rotated:
 *
 *   WHO        actor_profile_id + actor_class
 *   did WHAT   event_code (the canonical C2-4 vocabulary — there is no second
 *              taxonomy) + action_slug
 *   to WHICH   resource_type/resource_id, target_actor_id where relevant
 *   RESOURCE
 *   WHEN       occurred_at, always database time
 *   through    action_slug + correlation_id (joins back to C2-4 log lines)
 *   WHICH
 *   OUTCOME    outcome
 *
 * Selection rule: a signal becomes durable when it CHANGES authority, access,
 * external credential state, or money capability — or when it is an
 * authenticated cross-surface attempt. Everything else (ordinary login
 * failures, routine throttles, expected refusals, transient errors) stays LOG
 * ONLY. High-volume noise must not become permanent rows.
 *
 * This module is pure so the row shape, the auditable-code set and the
 * validation rules are testable without a server, exactly like the rest of
 * `src/domain/security/`.
 */

import { type SecurityEventCode } from "./event-codes";
import { isSensitiveKey, redactMetadata, SENSITIVE_KEY_FRAGMENTS } from "./redaction";
import { normalizeCorrelationId } from "./correlation-id";

/**
 * The codes this platform persists durably. A subset of `SECURITY_EVENTS`, by
 * deliberate selection — never a parallel vocabulary. The forward migration
 * seeds these exact codes into `private.security_audit_event_codes`, and the
 * database refuses any other value through that foreign key, so a code that is
 * not in both places cannot be persisted at all.
 *
 * Mirrors (keep in sync with the seed in
 * `supabase/migrations/20260826120000_c25_durable_security_audit.sql` — a test
 * asserts the two lists agree):
 *
 *   auth.password.changed                takeover-timeline anchor; rare
 *   auth.login.unassigned                de-provisioned account signal; rare
 *   authorization.context.denied         verified actor on the wrong surface
 *   authorization.team_supervision.read  privileged Team content access
 *   authorization.white_label.draft_saved  Platform Admin saved a Tenant draft
 *   integration.gmail.connected          external credential state created
 *   integration.gmail.disconnected       external credential state removed
 *   integration.gmail.reauthorization_required   consent lost / identity drift
 *   integration.gmail.disconnect_failed  possible live-but-invisible grant
 */
export const SECURITY_AUDIT_EVENT_CODES = [
  "integration.intake_secret.captured",
  "integration.intake_secret.revealed",
  "authorization.client_support.started",
  "authorization.client_support.action",
  "authorization.client_support.ended",
  "auth.password.changed",
  "auth.login.unassigned",
  "authorization.context.denied",
  "authorization.team_supervision.read",
  "authorization.white_label.draft_saved",
  "authorization.white_label.published",
  "integration.gmail.connected",
  "integration.gmail.disconnected",
  "integration.gmail.reauthorization_required",
  "integration.gmail.disconnect_failed",
] as const satisfies readonly SecurityEventCode[];

export type SecurityAuditEventCode = (typeof SECURITY_AUDIT_EVENT_CODES)[number];

export function isSecurityAuditEventCode(value: unknown): value is SecurityAuditEventCode {
  return typeof value === "string" && (SECURITY_AUDIT_EVENT_CODES as readonly string[]).includes(value);
}

/**
 * Which trust surface the recorded actor was acting on — the same classes the
 * C2-4 logger uses, plus `system` for rows written by trusted backend code
 * with no human caller. There is deliberately no class derived from anything a
 * browser sent.
 */
export type SecurityAuditActorClass = "internal" | "client" | "self_service" | "system" | "anonymous";

export type SecurityAuditOutcome = "succeeded" | "denied" | "failed";

/** Bounded machine tokens only — action slugs, resource types, provider names. */
const SAFE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUuid(value: string | null | undefined): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function safeToken(value: string | null | undefined): string | null {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * One durable audit row, exactly as it will be inserted.
 *
 * A `type` alias rather than an `interface` deliberately: supabase-js's table
 * generics constrain rows by `Record<string, unknown>`, and interfaces —
 * lacking an implicit index signature — collapse those generics to `never`.
 */
export type SecurityAuditRow = {
  readonly event_code: SecurityAuditEventCode;
  /** Database clock only. The writer never supplies this. */
  readonly occurred_at?: undefined;
  readonly actor_profile_id: string | null;
  readonly actor_class: SecurityAuditActorClass;
  readonly action_slug: string | null;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly target_actor_id: string | null;
  readonly provider: string | null;
  readonly outcome: SecurityAuditOutcome;
  readonly correlation_id: string | null;
  readonly metadata: Record<string, unknown>;
};

/**
 * The input a call site may offer. Like `SecurityEventInput`, the shape IS the
 * control: there is no field that could carry a password, a token, a cookie, an
 * authorization header, an OAuth code/state/verifier, or raw request material.
 */
export interface SecurityAuditInput {
  readonly event: SecurityEventCode;
  /**
   * The SERVER-DERIVED profile id. Never a browser-supplied id and never an
   * email: anything that is not a UUID is dropped rather than persisted, so a
   * call site that reaches for `formData.get(...)` produces no actor at all.
   */
  readonly actorId?: string | null;
  readonly actorClass?: SecurityAuditActorClass;
  /** The application action that produced the event, e.g. `auth.change_password`. */
  readonly actionSlug?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  /**
   * For privileged changes, WHO the change was done TO — a role change, a
   * provisioning action. Server-derived like every other identity here.
   */
  readonly targetActorId?: string | null;
  readonly provider?: string | null;
  readonly outcome?: SecurityAuditOutcome;
  readonly correlationId?: string | null;
  /** Redacted before persistence; secret-shaped keys are replaced unread. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Builds the insertable row without writing it. Returns `null` when nothing
 * should be persisted: an unknown code, or — deliberately — a code that exists
 * but was NOT selected for the durable trail. A caller cannot escalate a
 * LOG ONLY code into an audit row by passing it here; changing what is durable
 * means editing `SECURITY_AUDIT_EVENT_CODES` and the migration seed together,
 * which is a reviewable act.
 */
export function buildSecurityAuditRow(input: SecurityAuditInput): SecurityAuditRow | null {
  if (!isSecurityAuditEventCode(input.event)) return null;

  const resourceType = safeToken(input.resourceType);
  const resourceId = safeUuid(input.resourceId);
  const resourcePairComplete = (resourceType === null) === (resourceId === null);

  return {
    event_code: input.event,
    occurred_at: undefined,
    actor_profile_id: safeUuid(input.actorId),
    actor_class: input.actorClass ?? "system",
    action_slug: safeToken(input.actionSlug),
    resource_type: resourcePairComplete ? resourceType : null,
    resource_id: resourcePairComplete ? resourceId : null,
    target_actor_id: safeUuid(input.targetActorId),
    provider: safeToken(input.provider),
    outcome: input.outcome ?? "succeeded",
    correlation_id: normalizeCorrelationId(input.correlationId),
    metadata: sanitizeAuditMetadata(input.metadata),
  };
}

/**
 * Metadata for a PERMANENT row gets one stricter pass than log metadata.
 *
 * `redactMetadata` keeps sensitive keys with a `[redacted]` placeholder — right
 * for a transient log line, pointless in a table meant to live for years: the
 * key name itself says "there was a token here" and nothing else. Durable rows
 * therefore DROP those keys outright, at every depth, after the value shapes
 * have been scrubbed.
 *
 * The database adds its own independent check on top of this (`security_audit_
 * metadata_is_safe` refuses secret-shaped key names at insert time), so even a
 * writer that bypassed this builder cannot persist credential-shaped material.
 */
export function sanitizeAuditMetadata(metadata: unknown): Record<string, unknown> {
  const redacted = redactMetadata(metadata);
  if (!redacted) return {};

  const strip = (value: unknown, depth: number): unknown => {
    if (depth > 3) return null;
    if (Array.isArray(value)) return value.slice(0, 10).map((item) => strip(item, depth + 1));
    if (value !== null && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        if (!isSensitiveKey(key)) result[key] = strip(source[key], depth + 1);
      }
      return result;
    }
    return value;
  };

  return strip(redacted, 0) as Record<string, unknown>;
}

/**
 * Exported so the migration seed and this list can be compared by a test, and
 * so the database-side key checker and the TypeScript one visibly enforce the
 * same idea. Fragments here mirror `SENSITIVE_KEY_FRAGMENTS`; they are restated
 * in SQL inside the migration because Postgres cannot import this module.
 */
export const AUDIT_METADATA_FORBIDDEN_FRAGMENTS = SENSITIVE_KEY_FRAGMENTS;
