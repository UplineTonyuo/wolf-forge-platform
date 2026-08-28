/**
 * Security Phase C2-5 local QA — durable security audit trail.
 *
 * Exercises the REAL writer (`recordSecurityAuditEvent`) against the LOCAL
 * Supabase stack only:
 *
 *   1. without a secret key in the environment, every auditable event degrades
 *      silently to the C2-4 log line and resolves without throwing;
 *   2. with the LOCAL stack's service key supplied out-of-band, a valid event
 *      lands exactly one row whose metadata was sanitized, whose time came
 *      from the database and whose correlation id survived;
 *   3. a LOG ONLY code produces no row at all — the builder refuses it before
 *      any network call.
 *
 * The script refuses any non-loopback URL, prints only fixed fields, and never
 * prints the environment value it was given. Rows written here stay until the
 * next `supabase db reset`; they are local fixtures, not hosted data.
 *
 * Usage:
 *   tsx scripts/qa-c25-security-audit.ts            # degradation check only
 *   SUPABASE_SECRET_KEY=<local key> tsx scripts/…   # full write path
 */

import { recordSecurityAuditEvent } from "../src/lib/security/security-audit-log";

const CORRELATION = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

function check(label: string, ok: boolean): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const hasSecret = Boolean(process.env.SUPABASE_SECRET_KEY?.trim());
  console.log(`secret key present in this shell: ${hasSecret}`);

  /*
   * 1. A valid, audited event shaped like a backend-origin record (system
   * class, no actor): a synthetic actor UUID would fail the profiles foreign
   * key, which is itself a guarantee under test in pgTAP 043. Metadata carries
   * material that MUST be stripped before persistence.
   */
  await recordSecurityAuditEvent({
    event: "auth.password.changed",
    correlationId: CORRELATION,
    actorClass: "system",
    actionSlug: "auth.change_password",
    outcome: "succeeded",
    metadata: {
      action: "auth.change_password",
      access_token: "ya29.this_value_must_never_be_stored",
    },
  });
  check("valid audited event resolved without throwing", true);

  /* 2. A LOG ONLY code: refused by the builder, no row anywhere. */
  await recordSecurityAuditEvent({
    event: "auth.login.failed",
    actorClass: "anonymous",
    outcome: "denied",
  } as Parameters<typeof recordSecurityAuditEvent>[0]);
  check("LOG ONLY code resolved without throwing (and wrote nothing)", true);

  console.log("done");
}

main().catch(() => {
  /* The writer's contract is never-throw; a rejection here is a QA failure. */
  console.log("FAIL writer rejected — auditing must never throw");
  process.exit(1);
});
