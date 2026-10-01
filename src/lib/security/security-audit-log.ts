import "server-only";

import {
  buildSecurityAuditRow,
  type SecurityAuditInput,
  type SecurityAuditRow,
} from "../../domain/security/audit";
import { readServerEnvironment } from "../env/server-env";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";
import type { Json } from "../supabase/database.types";

/**
 * The durable security audit writer. Server-only, vendor-neutral, never throws.
 *
 * ## Relationship to the C2-4 logger
 *
 * `recordSecurityEvent` writes an ephemeral JSON line for EVERY security
 * signal. This writer persists a row ONLY for the codes selected into
 * `SECURITY_AUDIT_EVENT_CODES` — the builder returns `null` for anything else,
 * so a call site cannot accidentally turn a routine login failure into a
 * permanent record. The two share one taxonomy, one redactor and one
 * correlation identifier; this is an escalation of selected signals, not a
 * second stream with its own vocabulary.
 *
 * ## Who may write
 *
 * Rows land in `public.security_audit_events`, which holds no grant for any
 * browser role — not even SELECT. The only application-side writer is the
 * trusted server client (`SUPABASE_SECRET_KEY`, service role) used here, and
 * the table's privileges allow that role INSERT alone: even it cannot update,
 * delete or read audit rows back through the Data API. Actor ids, timestamps
 * and metadata are validated by `buildSecurityAuditRow` before anything is sent,
 * and re-validated by database constraints behind it.
 *
 * ## Why never throws
 *
 * Same contract as the logger: observability that can reject turns a handled
 * failure into an unhandled one. An absent secret key, a paused database or a
 * broken sink degrades to the C2-4 log line alone — which every audit-worthy
 * call site also writes — and must never break the request being audited.
 */

/**
 * Replaces the default trusted-client write path. Exists for tests, exactly
 * like `setSecurityLogSink`: assertions inspect the ROW rather than a database.
 * Pass `null` to restore the default.
 */
export type SecurityAuditSink = (row: SecurityAuditRow) => Promise<void>;

let sink: SecurityAuditSink | null = null;

export function setSecurityAuditSink(next: SecurityAuditSink | null): void {
  sink = next;
}

let cachedClient: ReturnType<typeof createTrustedServerSupabaseClient> | null = null;

function trustedAuditClient(): ReturnType<typeof createTrustedServerSupabaseClient> {
  if (!cachedClient) {
    cachedClient = createTrustedServerSupabaseClient(readServerEnvironment());
  }
  return cachedClient;
}

async function writeToDatabase(row: SecurityAuditRow): Promise<void> {
  // A fresh process without SUPABASE_SECRET_KEY (KI-027) must degrade to the
  // C2-4 log line, not raise. The throw is caught by the caller's guard.
  const client = trustedAuditClient();
  const { error } = await client.from("security_audit_events").insert({
    ...row,
    metadata: row.metadata as Json,
  });
  if (error) {
    /* Deliberately silent — see the contract above. */
  }
}

/**
 * Persists one durable audit row. Never throws, never rejects, returns nothing
 * a caller could branch on. Awaited at state-changing call sites that redirect
 * afterwards (`redirect()` throws, so the row must be written first).
 */
export async function recordSecurityAuditEvent(input: SecurityAuditInput): Promise<void> {
  try {
    const row = buildSecurityAuditRow(input);
    if (!row) return;

    if (sink) {
      await sink(row);
      return;
    }

    await writeToDatabase(row);
  } catch {
    /* Deliberately silent. See the contract above. */
  }
}
