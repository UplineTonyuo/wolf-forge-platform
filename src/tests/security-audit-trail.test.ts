import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Security Phase C2-5 — durable audit trail control suite.
 *
 * Same two styles as its sibling suites, deliberately:
 *
 *   behaviour   the row builder, the sanitizer and the lifecycle gate are
 *               pure, so they are asserted directly — structurally, field by
 *               field, not just by searching serialized output.
 *   source      the SELECTION POLICY lives at call sites ("which C2-4 signals
 *               become permanent rows"), so it is pinned against the file
 *               text: one durable write per qualifying site, none anywhere
 *               else, and nothing credential-shaped reachable by any of them.
 *
 * The failure modes this suite exists to catch are silent ones: a LOG ONLY
 * code quietly becoming durable, an audit row learning to carry a token, or a
 * second vocabulary drifting away from the C2-4 taxonomy.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

/** Everything between one call's opening paren and its matching close. */
function callBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) return "";
  let depth = 0;
  let opened = false;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") {
      depth += 1;
      opened = true;
    }
    if (character === ")") {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const {
  SECURITY_EVENTS,
} = await import("../domain/security/event-codes");

const {
  AUDIT_METADATA_FORBIDDEN_FRAGMENTS,
  SECURITY_AUDIT_EVENT_CODES,
  buildSecurityAuditRow,
  sanitizeAuditMetadata,
} = await import("../domain/security/audit");

const {
  REDACTED,
  REDACTED_EMAIL,
} = await import("../domain/security/redaction");

const {
  isGmailLifecycleAuditEvent,
} = await import("../lib/integrations/gmail-audit");

const {
  recordSecurityAuditEvent,
  setSecurityAuditSink,
} = await import("../lib/security/security-audit-log");

/* Version-4-shaped, so they survive the same UUID validation production uses. */
const UUID_A = "a1a2a3a4-b1b2-4c1c-8d1d-e1e2e3e4e5e6";
const UUID_B = "b1b2b3b4-a1a2-4b1b-8c2c-d1d1d1d1d1d1";
const CORRELATION = "0123456789abcdef0123456789abcdef";

beforeEach(() => setSecurityAuditSink(null));
afterEach(() => setSecurityAuditSink(null));

/* ========================================================================== */

describe("the auditable selection is a deliberate subset of the C2-4 taxonomy", () => {
  it("contains exactly the codes this phase selected as durable", () => {
    expect([...SECURITY_AUDIT_EVENT_CODES].sort()).toEqual(
      [
        "auth.password.changed",
        "auth.login.unassigned",
        "authorization.client_support.started",
        "authorization.client_support.action",
        "authorization.client_support.ended",
        "authorization.context.denied",
        "authorization.team_supervision.read",
        "authorization.white_label.draft_saved",
        "authorization.white_label.published",
        "integration.gmail.connected",
        "integration.gmail.disconnected",
        "integration.gmail.reauthorization_required",
        "integration.gmail.disconnect_failed",
      ].sort(),
    );
  });

  it("never invents a code outside the C2-4 vocabulary — there is no second taxonomy", () => {
    for (const code of SECURITY_AUDIT_EVENT_CODES) {
      expect(Object.hasOwn(SECURITY_EVENTS, code)).toBe(true);
    }
  });

  it("keeps every selected code a valid SecurityEventCode per the type guard", () => {
    for (const code of SECURITY_AUDIT_EVENT_CODES) {
      expect(isSecurityEventCodeSafe(code)).toBe(true);
    }
  });

  it("added the two lifecycle-success codes the trail needs, in the integration category", () => {
    expect(SECURITY_EVENTS["integration.gmail.connected"]).toBeDefined();
    expect(SECURITY_EVENTS["integration.gmail.disconnected"]).toBeDefined();
    expect(SECURITY_EVENTS["integration.gmail.connected"].category).toBe("integration");
    expect(SECURITY_EVENTS["integration.gmail.disconnected"].category).toBe("integration");
  });
});

function isSecurityEventCodeSafe(code: string): boolean {
  return Object.hasOwn(SECURITY_EVENTS, code);
}

describe("the durable row builder refuses what must not be persisted", () => {
  it("builds the full row for a canonical audited event", () => {
    const row = buildSecurityAuditRow({
      event: "auth.password.changed",
      correlationId: CORRELATION,
      actorId: UUID_A,
      actorClass: "self_service",
      actionSlug: "auth.change_password",
      outcome: "succeeded",
      metadata: { action: "auth.change_password", other_logins_revoked: true },
    });

    expect(row).not.toBeNull();
    expect(row?.event_code).toBe("auth.password.changed");
    expect(row?.actor_profile_id).toBe(UUID_A);
    expect(row?.actor_class).toBe("self_service");
    expect(row?.action_slug).toBe("auth.change_password");
    expect(row?.outcome).toBe("succeeded");
    expect(row?.correlation_id).toBe(CORRELATION);
    expect(row?.metadata).toEqual({ action: "auth.change_password", other_logins_revoked: true });
    /* The database owns time. The writer supplies none. */
    expect(row && "occurred_at" in row ? row.occurred_at : "present").toBeUndefined();
  });

  it("returns null for an unknown code", () => {
    expect(
      buildSecurityAuditRow({
        event: "definitely.not.a.code" as Parameters<typeof buildSecurityAuditRow>[0]["event"],
        outcome: "denied",
      }),
    ).toBeNull();
  });

  it("refuses to escalate a LOG ONLY code into a permanent row", () => {
    /* Ordinary wrong-password attempts stay out of the durable trail. */
    expect(buildSecurityAuditRow({ event: "auth.login.failed" })).toBeNull();
    expect(buildSecurityAuditRow({ event: "abuse.rate_limited" })).toBeNull();
    expect(buildSecurityAuditRow({ event: "economic.purchase.denied" })).toBeNull();
    expect(buildSecurityAuditRow({ event: "system.unexpected_error" })).toBeNull();
  });

  it("drops an actor id that is not a server-derived UUID — including a login-form email", () => {
    const row = buildSecurityAuditRow({
      event: "auth.login.unassigned",
      actorId: "attacker@example.com",
      actorClass: "anonymous",
      outcome: "denied",
    });

    expect(row?.actor_profile_id).toBeNull();
    expect(JSON.stringify(row)).not.toContain("attacker@example.com");
  });

  it("keeps a real actor id and normalizes its case", () => {
    const row = buildSecurityAuditRow({
      event: "auth.password.changed",
      actorId: UUID_A.toUpperCase(),
      outcome: "succeeded",
    });

    expect(row?.actor_profile_id).toBe(UUID_A);
  });

  it("normalizes the correlation id and refuses a malformed one rather than persisting junk", () => {
    const good = buildSecurityAuditRow({
      event: "authorization.context.denied",
      correlationId: CORRELATION.toUpperCase(),
      outcome: "denied",
    });
    expect(good?.correlation_id).toBe(CORRELATION);

    const hostile = buildSecurityAuditRow({
      event: "authorization.context.denied",
      correlationId: "'; DROP TABLE users; --",
      outcome: "denied",
    });
    expect(hostile?.correlation_id).toBeNull();
  });

  it("keeps both halves of a resource identity or neither", () => {
    const complete = buildSecurityAuditRow({
      event: "authorization.context.denied",
      resourceType: "surface",
      resourceId: undefined,
      outcome: "denied",
    });
    expect(complete?.resource_type).toBeNull();
    expect(complete?.resource_id).toBeNull();

    const paired = buildSecurityAuditRow({
      event: "integration.gmail.connected",
      resourceType: "integration_connection",
      resourceId: UUID_B,
      outcome: "succeeded",
    });
    expect(paired?.resource_type).toBe("integration_connection");
    expect(paired?.resource_id).toBe(UUID_B);
  });

  it("preserves the audited TARGET of a privileged change separately from the actor", () => {
    const row = buildSecurityAuditRow({
      event: "authorization.context.denied",
      actorId: UUID_B,
      targetActorId: UUID_A,
      outcome: "denied",
    });

    expect(row?.actor_profile_id).toBe(UUID_B);
    expect(row?.target_actor_id).toBe(UUID_A);
  });
});

describe("durable metadata is stricter than log metadata", () => {
  it("drops sensitive KEYS entirely instead of leaving [redacted] placeholders behind", () => {
    const metadata = sanitizeAuditMetadata({
      access_token: "ya29.notarealtoken",
      nested: { refresh_token: "1//" + "x".repeat(24) },
      reason: "reauthorization_required",
    });

    expect(metadata).toEqual({ nested: {}, reason: "reauthorization_required" });
  });

  it("still scrubs secret-shaped VALUES that hide inside innocent strings", () => {
    const metadata = sanitizeAuditMetadata({
      note: "Bearer abcdefghijklmnopqrstuvwxyz012345",
      contact: "person@example.com",
    });

    expect(metadata.note).toBe(REDACTED);
    expect(metadata.contact).toBe(REDACTED_EMAIL);
  });

  it("enforces the same forbidden fragments the database checker restates", () => {
    expect(AUDIT_METADATA_FORBIDDEN_FRAGMENTS).toContain("password");
    expect(AUDIT_METADATA_FORBIDDEN_FRAGMENTS).toContain("token");
    expect(AUDIT_METADATA_FORBIDDEN_FRAGMENTS).toContain("cookie");
  });

  it("degrades garbage without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    /* Depth-capped by the redactor, key-stripped here — never an exception. */
    expect(() => sanitizeAuditMetadata(circular)).not.toThrow();
    expect(typeof sanitizeAuditMetadata(circular)).toBe("object");
    expect(sanitizeAuditMetadata("not an object")).toEqual({});
  });
});

describe("the writer fails safe", () => {
  it("writes the built row through the sink untouched", async () => {
    const seen: unknown[] = [];
    setSecurityAuditSink(async (row) => {
      seen.push(row);
    });

    await recordSecurityAuditEvent({
      event: "auth.password.changed",
      actorId: UUID_A,
      actorClass: "self_service",
      actionSlug: "auth.change_password",
      outcome: "succeeded",
      correlationId: CORRELATION,
    });

    expect(seen).toHaveLength(1);
  });

  it("swallows a sink that throws — auditing must never break the request being audited", async () => {
    setSecurityAuditSink(async () => {
      throw new Error("database paused");
    });

    await expect(
      recordSecurityAuditEvent({
        event: "auth.password.changed",
        actorId: UUID_A,
        outcome: "succeeded",
      }),
    ).resolves.toBeUndefined();
  });

  it("calls the sink nothing at all for a LOG ONLY code", async () => {
    const seen: unknown[] = [];
    setSecurityAuditSink(async (row) => {
      seen.push(row);
    });

    await recordSecurityAuditEvent({ event: "auth.login.failed" });

    expect(seen).toHaveLength(0);
  });
});

describe("the Gmail lifecycle gate admits only credential-state transitions", () => {
  it.each([
    ["integration.gmail.connected", true],
    ["integration.gmail.disconnected", true],
    ["integration.gmail.reauthorization_required", true],
    ["integration.gmail.disconnect_failed", true],
    ["integration.gmail.connect_failed", false],
    ["integration.gmail.verify_failed", false],
    ["integration.gmail.oauth_state_mismatch", false],
    ["integration.gmail.not_configured", false],
  ] as const)("classifies %s as %s", (event, expected) => {
    expect(isGmailLifecycleAuditEvent(event)).toBe(expected);
  });

  it("offers no parameter that could carry OAuth material or a mailbox address", () => {
    const source = read("src/lib/integrations/gmail-audit.ts");
    const start = source.indexOf("recordGmailLifecycleAudit(input: {");
    const end = source.indexOf("}): Promise", start);
    const inputType = source.slice(start, end);

    expect(inputType).toContain("event:");
    expect(inputType).toContain("action:");
    expect(inputType).toContain("actorId");
    expect(inputType).toContain("outcome");
    expect(inputType).not.toMatch(/\b(code|state|verifier|token|secret|email)\??\s*:/);
  });
});

/* ========================================================================== *
 * Source posture: the selection policy lives at the call sites.
 * ========================================================================== */

describe("the password-change surface persists exactly one durable row, successes only", () => {
  const source = read("src/app/actions/security.ts");

  it("writes durably exactly once in the whole action", () => {
    expect(countOccurrences(source, "recordSecurityAuditEvent(")).toBe(1);
    expect(countOccurrences(source, '"auth.password.changed"')).toBeGreaterThanOrEqual(2);
  });

  it("places the durable write after the success boundary, never in the refusal branch", () => {
    const successBoundary = source.indexOf('await supabase.auth.signOut({ scope: "others" })');
    const auditCall = source.indexOf("recordSecurityAuditEvent(");

    expect(successBoundary).toBeGreaterThan(-1);
    expect(auditCall).toBeGreaterThan(successBoundary);

    /* The wrong-current-password branch ends before the success boundary. */
    const refusalBranch = source.slice(source.indexOf("if (error)"), successBoundary);
    expect(refusalBranch).not.toContain("recordSecurityAuditEvent");
  });

  it("derives identity only from the verified context, never from the form", () => {
    const auditCall = callBlock(source, "recordSecurityAuditEvent(");
    expect(auditCall).toContain("context.actor.id");
    expect(auditCall).not.toContain("formData");
    expect(auditCall.toLowerCase()).not.toContain("password:");
  });
});

describe("the sign-in surface persists only the unassigned-account signal", () => {
  const source = read("src/app/actions/auth.ts");

  it("writes durably exactly once, in the unassigned branch", () => {
    expect(countOccurrences(source, "recordSecurityAuditEvent(")).toBe(1);

    const unassignedLog = source.indexOf('"auth.login.unassigned"');
    const auditCall = source.indexOf("recordSecurityAuditEvent(");
    expect(unassignedLog).toBeGreaterThan(-1);
    expect(auditCall).toBeGreaterThan(unassignedLog);
  });

  it("never makes ordinary failures or successful logins durable", () => {
    const failureBranch = source.slice(0, source.indexOf('"auth.login.succeeded"'));
    expect(failureBranch).not.toContain("recordSecurityAuditEvent(");
    expect(countOccurrences(source, '"auth.login.unassigned"')).toBe(2);
  });

  it("carries the verified actor id, never anything typed into the form", () => {
    const auditCall = callBlock(source, "recordSecurityAuditEvent(");
    expect(auditCall).toMatch(/actor\??\.id/);
    expect(auditCall).not.toContain("email");
    expect(auditCall).not.toContain("formData");
  });
});

describe("context resolvers persist only the cross-surface denial", () => {
  const source = read("src/lib/supabase/next-server.ts");

  it("guards the single durable write on authorization.context.denied", () => {
    expect(countOccurrences(source, "recordSecurityAuditEvent(")).toBe(1);
    expect(source).toContain('input.event === "authorization.context.denied"');
  });

  it("leaves unauthenticated bookmarks and unverified sessions as log lines only", () => {
    const guardIndex = source.indexOf('input.event === "authorization.context.denied"');
    const guardBlock = source.slice(guardIndex, guardIndex + 400);
    expect(guardBlock).not.toContain("unauthenticated");
    expect(guardBlock).not.toContain("session.unverified");
  });

  it("awaits the writer before redirect can throw", () => {
    const guardIndex = source.indexOf('input.event === "authorization.context.denied"');
    expect(source.slice(guardIndex - 200, guardIndex + 200)).toContain("await recordSecurityAuditEvent");
  });
});

describe("Gmail routes persist only lifecycle transitions", () => {
  it("callback: connected, successes only", () => {
    const source = read(
      "src/app/(internal)/settings/integrations/gmail/callback/route.ts",
    );
    expect(countOccurrences(source, "recordGmailLifecycleAudit(")).toBe(1);
    expect(source).toContain('"integration.gmail.connected"');
    expect(source.indexOf(".completeAuthorization(")).toBeLessThan(
      source.indexOf("recordGmailLifecycleAudit({"),
    );
  });

  it("disconnect: disconnected AND disconnect_failed, each exactly once", () => {
    const source = read(
      "src/app/(internal)/settings/integrations/gmail/disconnect/route.ts",
    );
    expect(countOccurrences(source, "recordGmailLifecycleAudit(")).toBe(2);
    expect(countOccurrences(source, '"integration.gmail.disconnected"')).toBe(1);
    expect(countOccurrences(source, '"integration.gmail.disconnect_failed"')).toBe(2);
  });

  it("verify: only the degraded-connection branch, gated on the expired error", () => {
    const source = read(
      "src/app/(internal)/settings/integrations/gmail/verify/route.ts",
    );
    expect(countOccurrences(source, "recordGmailLifecycleAudit(")).toBe(1);
    expect(source).toMatch(/if \(expired\) \{[\s\S]*recordGmailLifecycleAudit/);
  });

  it("connect: starts the OAuth dance and persists nothing", () => {
    const source = read(
      "src/app/(internal)/settings/integrations/gmail/connect/route.ts",
    );
    expect(source).not.toContain("recordGmailLifecycleAudit");
  });

  it("every lifecycle call names the verified internal actor", () => {
    for (const route of ["callback", "disconnect", "verify"]) {
      const source = read(
        `src/app/(internal)/settings/integrations/gmail/${route}/route.ts`,
      );
      const calls = source.split("recordGmailLifecycleAudit(").slice(1);
      for (const call of calls) {
        expect(call.slice(0, call.indexOf("});"))).toContain("context.actor.id");
      }
    }
  });
});

describe("the migration seed and the TypeScript selection agree", () => {
  it("seeds exactly the codes SECURITY_AUDIT_EVENT_CODES selects", () => {
    const migrations = [
      "supabase/migrations/20260826120000_c25_durable_security_audit.sql",
      "supabase/migrations/20260928202728_team_supervision_audit_foundation.sql",
      "supabase/migrations/20261010090000_white_label_drafts.sql",
      "supabase/migrations/20261013120050_draft_bound_white_label_publication.sql",
      "supabase/migrations/20261028201119_client_support_sessions.sql",
    ].map(read);
    const seeded = migrations.flatMap((migration) =>
      [...migration.matchAll(/(?:values|,)\s*\('([a-z][a-z0-9._]*)',\s*'(?:authentication|authorization|integration)'/g)]
        .map((match) => match[1]),
    );

    expect(seeded.sort()).toEqual([...SECURITY_AUDIT_EVENT_CODES].sort());
  });
});

describe("no durable call site can be fed request material", () => {
  const sites: Array<[string, string]> = [
    ["password change", "src/app/actions/security.ts"],
    ["sign-in", "src/app/actions/auth.ts"],
    ["context resolvers", "src/lib/supabase/next-server.ts"],
    ["gmail audit helper", "src/lib/integrations/gmail-audit.ts"],
  ];

  it.each(sites)("%s: the audit block mentions no form, header or provider artifact", (_label, path) => {
    const source = read(path);
    const auditCall = callBlock(source, "recordSecurityAuditEvent(");

    if (auditCall) {
      expect(auditCall).not.toContain("formData");
      expect(auditCall).not.toMatch(/\bheaders\b/);
      expect(auditCall.toLowerCase()).not.toMatch(/\b(password|token|cookie|secret)\b\s*[:)]/);
    }
  });
});
