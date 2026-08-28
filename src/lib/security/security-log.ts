import "server-only";

import {
  SECURITY_EVENTS,
  securityEventDefinition,
  type SecurityEventCategory,
  type SecurityEventCode,
  type SecuritySeverity,
} from "../../domain/security/event-codes";
import { redactMetadata } from "../../domain/security/redaction";
import { isCorrelationId } from "../../domain/security/correlation-id";
import type { FailureClass } from "../../domain/security/error-classification";

/**
 * The structured security logger. Server-only, vendor-neutral, synchronous.
 *
 * ## The shape IS the control
 *
 * The primary defence against leaking a credential into a log is not the
 * redactor — it is that `SecurityEventInput` has nowhere to put one. There is
 * no `message`, no `error`, no `request`, no `headers`, no `body`. Every field
 * is either a stable code, a UUID, a bounded enum or metadata that must survive
 * `redactMetadata`. Someone reaching for "just log the whole error" has to
 * change this type first, and that is a reviewable act.
 *
 * ## Why synchronous, and why no vendor
 *
 * A logger that awaits cannot be called from an ordinary `catch`, and a logger
 * that can throw or reject turns a handled failure into an unhandled one. This
 * one writes a single JSON line to stdout/stderr inside a `try`, and returns.
 * Vercel, Docker and `next start` all collect those; nothing here knows or
 * cares which. An external sink can be attached later through
 * `setSecurityLogSink` without touching a single call site — that seam is
 * deliberate (no Sentry/Datadog/PostHog dependency is introduced here).
 *
 * ## Why `process.stdout` rather than `console`
 *
 * Two reasons. `console` is patched by test frameworks, dev overlays and
 * instrumentation, so a log line can silently change shape or vanish. And the
 * console audit for this phase asserts that production code contains no raw
 * `console.*` diagnostics outside the two React error boundaries — writing
 * through the stream keeps that assertion true and unambiguous.
 */

/** One serialized security event. `v` is the schema version of this record. */
export interface SecurityLogRecord {
  readonly log: "security";
  readonly v: 1;
  readonly ts: string;
  readonly event: SecurityEventCode;
  readonly category: SecurityEventCategory;
  readonly severity: SecuritySeverity;
  readonly correlation_id?: string;
  readonly actor_id?: string;
  readonly actor_class?: ActorClass;
  readonly resource_type?: string;
  readonly resource_id?: string;
  readonly provider?: string;
  readonly outcome?: EventOutcome;
  readonly failure_class?: FailureClass;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Which trust surface the caller was acting on. Not the caller's ROLE — roles
 * change and are not needed to triage; the surface is what makes a
 * cross-boundary attempt visible.
 */
export type ActorClass = "internal" | "client" | "self_service" | "anonymous";

export type EventOutcome = "succeeded" | "denied" | "failed";

export interface SecurityEventInput {
  readonly event: SecurityEventCode;
  readonly correlationId?: string | null;
  /**
   * The SERVER-DERIVED profile id, never a browser-supplied one, and never an
   * email. Anything that is not a UUID is dropped rather than logged, so a call
   * site that reaches for `formData.get("email")` here produces no actor at all
   * instead of writing an address into the log.
   */
  readonly actorId?: string | null;
  readonly actorClass?: ActorClass;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly provider?: string | null;
  readonly outcome?: EventOutcome;
  readonly failureClass?: FailureClass;
  readonly metadata?: Record<string, unknown>;
}

export type SecurityLogSink = (record: SecurityLogRecord) => void;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Short, bounded machine tokens only — resource types, provider names. */
const SAFE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

let sink: SecurityLogSink | null = null;

/**
 * Replaces the default stdout/stderr sink.
 *
 * Exists for two reasons and no others: tests assert on the RECORD rather than
 * on parsed console text, and a future external drain can be attached here
 * without editing any call site. Pass `null` to restore the default.
 */
export function setSecurityLogSink(next: SecurityLogSink | null): void {
  sink = next;
}

function safeUuid(value: string | null | undefined): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function safeToken(value: string | null | undefined): string | undefined {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value) ? value : undefined;
}

/**
 * Builds the record without writing it. Exported so tests can assert the
 * serialized shape directly, and so the write path has nothing in it but I/O.
 *
 * Returns `null` for an unknown event code. A typo'd code is a defect, but it
 * is not worth an exception at a failure site — the alternative is a logger
 * that crashes the very request it was added to observe.
 */
export function buildSecurityLogRecord(
  input: SecurityEventInput,
  now: Date = new Date(),
): SecurityLogRecord | null {
  if (!Object.hasOwn(SECURITY_EVENTS, input.event)) return null;

  const definition = securityEventDefinition(input.event);
  const metadata = redactMetadata(input.metadata);

  const record: SecurityLogRecord = {
    log: "security",
    v: 1,
    ts: now.toISOString(),
    event: input.event,
    category: definition.category,
    severity: definition.severity,
    ...(isCorrelationId(input.correlationId) ? { correlation_id: input.correlationId } : {}),
    ...(safeUuid(input.actorId) ? { actor_id: safeUuid(input.actorId) } : {}),
    ...(input.actorClass ? { actor_class: input.actorClass } : {}),
    ...(safeToken(input.resourceType) ? { resource_type: safeToken(input.resourceType) } : {}),
    ...(safeUuid(input.resourceId) ? { resource_id: safeUuid(input.resourceId) } : {}),
    ...(safeToken(input.provider) ? { provider: safeToken(input.provider) } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.failureClass ? { failure_class: input.failureClass } : {}),
    ...(metadata ? { metadata } : {}),
  };

  return record;
}

function write(record: SecurityLogRecord): void {
  const line = `${JSON.stringify(record)}\n`;
  const stream = record.severity === "info" ? process.stdout : process.stderr;
  stream.write(line);
}

/**
 * Records one security event. Never throws, never rejects, never returns a
 * value a caller could branch on.
 *
 * The whole body is guarded: a broken sink, an unserializable metadata value or
 * a closed stdout must not be able to convert a handled failure into an
 * unhandled one. Observability that can take the request down is not
 * observability.
 */
export function recordSecurityEvent(input: SecurityEventInput): void {
  try {
    const record = buildSecurityLogRecord(input);
    if (!record) return;

    if (sink) {
      sink(record);
      return;
    }

    write(record);
  } catch {
    /* Deliberately silent. See the contract above. */
  }
}
