import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security Phase C2-4 — monitoring / logging control suite.
 *
 * Like `security-controls.test.ts`, these pin POSTURE rather than a feature.
 * The failure mode this suite exists to catch is silent: a logger keeps
 * "working" perfectly while it starts writing a refresh token, or while an
 * event code quietly changes and every downstream query stops matching.
 *
 * Two styles, both deliberate:
 *
 *   behaviour   the taxonomy, the redactor, the classifier and the record
 *               builder are pure, so they are asserted directly — and payloads
 *               are asserted STRUCTURALLY (field by field) as well as by
 *               searching the serialized line, because a string search alone
 *               passes trivially when the field was never populated.
 *   source      posture that lives in a server action, a route handler or the
 *               proxy is asserted against the file text, following the
 *               convention already used for the CSP and the error boundary.
 */

const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

/*
 * `next/headers` throws outside a request. The correlation reader already
 * degrades to null when it does, but mocking it lets the suite prove the
 * correlation id actually reaches the record rather than merely proving the
 * guard works.
 */
let mockCorrelationHeader: string | null = null;

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === "x-wolf-forge-request-id" ? mockCorrelationHeader : null,
  }),
}));

const {
  SECURITY_EVENTS,
  SECURITY_EVENT_PREFIXES,
  isSecurityEventCode,
  securityEventDefinition,
} = await import("../domain/security/event-codes");

const {
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_KEYS,
  MAX_STRING_LENGTH,
  REDACTED,
  REDACTED_DIGITS,
  REDACTED_EMAIL,
  isSensitiveKey,
  redactMetadata,
  redactString,
} = await import("../domain/security/redaction");

const {
  classifyApplicationErrorCode,
  classifySignInFailure,
  safeProviderCode,
} = await import("../domain/security/error-classification");

const {
  CORRELATION_HEADER,
  createCorrelationId,
  isCorrelationId,
  normalizeCorrelationId,
} = await import("../domain/security/correlation-id");

const { buildSecurityLogRecord, recordSecurityEvent, setSecurityLogSink } = await import(
  "../lib/security/security-log"
);
type SecurityLogRecord = Awaited<
  ReturnType<typeof import("../lib/security/security-log").buildSecurityLogRecord>
>;

const { observeActionFailure } = await import("../lib/security/observed-failure");

const {
  ConflictError,
  DatabaseError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitedError,
  ValidationError,
} = await import("../lib/errors/application-error");

/* ------------------------------------------------------------------ setup -- */

let captured: NonNullable<SecurityLogRecord>[] = [];

beforeEach(() => {
  captured = [];
  mockCorrelationHeader = null;
  setSecurityLogSink((record) => {
    captured.push(record);
  });
});

afterEach(() => {
  setSecurityLogSink(null);
});

/** The whole event, serialized exactly as it would reach a log drain. */
function serialized(): string {
  return captured.map((record) => JSON.stringify(record)).join("\n");
}

/* ------------------------------------------------------------- taxonomy --- */

describe("event taxonomy is stable and self-consistent", () => {
  it("gives every code a category prefix that matches its category", () => {
    for (const [code, definition] of Object.entries(SECURITY_EVENTS)) {
      const expectedPrefix = SECURITY_EVENT_PREFIXES[definition.category];
      expect(`${code} -> ${code.split(".")[0]}`).toBe(`${code} -> ${expectedPrefix}`);
    }
  });

  it("uses only the three declared severities", () => {
    for (const definition of Object.values(SECURITY_EVENTS)) {
      expect(["info", "warn", "error"]).toContain(definition.severity);
    }
  });

  it("keeps codes machine-readable — no spaces, no capitals, no prose", () => {
    for (const code of Object.keys(SECURITY_EVENTS)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });

  it("carries the codes this phase's controls depend on", () => {
    /*
     * Pinned by name. These are the codes an operator's queries and any future
     * alert rule bind to; renaming one is a breaking change and has to be a
     * deliberate edit here, not a silent refactor.
     */
    for (const code of [
      "auth.login.failed",
      "auth.login.rate_limited",
      "auth.login.succeeded",
      "authorization.context.denied",
      "authorization.capability.denied",
      "abuse.rate_limited",
      "integration.gmail.oauth_state_mismatch",
      "integration.gmail.reauthorization_required",
      "system.database.failed",
    ]) {
      expect(isSecurityEventCode(code)).toBe(true);
    }
  });

  it("keeps an ordinary login failure quieter than a throttled one (KI-029)", () => {
    /*
     * The distinction is the point of the phase: a wrong password is routine,
     * a shared-bucket throttle is a platform-wide availability event.
     */
    expect(securityEventDefinition("auth.login.failed").severity).toBe("info");
    expect(securityEventDefinition("auth.login.rate_limited").severity).toBe("warn");
  });

  it("rejects a code that is not in the map", () => {
    expect(isSecurityEventCode("auth.login.definitely_not_real")).toBe(false);
    expect(isSecurityEventCode("toString")).toBe(false);
    expect(isSecurityEventCode(42)).toBe(false);
  });
});

/* ------------------------------------------------------------ redaction --- */

describe("redaction refuses credentials by key name", () => {
  it("drops the key names that carry authentication material", () => {
    for (const key of [
      "password",
      "new_password",
      "currentPassword",
      "access_token",
      "refreshToken",
      "authorization",
      "Cookie",
      "set-cookie",
      "GOOGLE_CLIENT_SECRET",
      "apiKey",
      "api_key",
      "service_role_key",
      "sessionId",
      "code_verifier",
      "jwt",
      "credentials",
    ]) {
      expect(`${key}:${isSensitiveKey(key)}`).toBe(`${key}:true`);
    }
  });

  it("treats the OAuth code and state as sensitive without swallowing error_code", () => {
    expect(isSensitiveKey("code")).toBe(true);
    expect(isSensitiveKey("state")).toBe(true);
    /* These are the safe, useful ones and must survive. */
    expect(isSensitiveKey("error_code")).toBe(false);
    expect(isSensitiveKey("provider_code")).toBe(false);
    expect(isSensitiveKey("status_code")).toBe(false);
    expect(isSensitiveKey("action")).toBe(false);
    expect(isSensitiveKey("module_key")).toBe(false);
  });

  it("never inspects the value of a sensitive key", () => {
    const redacted = redactMetadata({ password: "hunter2", access_token: "ya29.abcdef" });
    expect(redacted).toEqual({ password: REDACTED, access_token: REDACTED });
  });
});

describe("redaction refuses credentials by value shape", () => {
  const secrets: ReadonlyArray<readonly [string, string]> = [
    ["supabase session JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["google access token", "ya29.a0AfH6SMBx1234567890abcdefghij"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["google refresh token", "1//0eXaMpLe-refresh-token-value"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["google api key", "AIzaSyA1234567890abcdefghijklmnopqrstu"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["stripe secret key", "sk_live_51H1234567890abcdef"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["stripe webhook secret", "whsec_abcdefghij1234567890"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["github token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["aws access key id", "AKIAIOSFODNN7EXAMPLE"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["supabase secret key", "sb_secret_abcdefghij1234567890"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
    ["authorization header", "Bearer abcdefghijklmnopqrstuvwxyz"], // secret-scan:allow(non-issued security redaction test fixture); gitleaks:allow
  ];

  for (const [label, secret] of secrets) {
    it(`scrubs a ${label} wherever it appears in a string`, () => {
      const scrubbed = redactString(`provider said: ${secret} (retry)`);
      expect(scrubbed).not.toContain(secret);
      expect(scrubbed).toContain(REDACTED);
    });
  }

  it("scrubs secrets nested inside otherwise innocent metadata", () => {
    const redacted = redactMetadata({
      detail: "refresh failed for ya29.a0AfH6SMBx1234567890abcdefghij",
      nested: { note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue" },
    });

    const text = JSON.stringify(redacted);
    expect(text).not.toContain("ya29.");
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("removes email addresses and long digit runs", () => {
    expect(redactString("owner@wolfforge.example asked")).toContain(REDACTED_EMAIL);
    expect(redactString("owner@wolfforge.example")).not.toContain("wolfforge.example");
    expect(redactString("card 4242424242424242")).toContain(REDACTED_DIGITS);
  });

  it("leaves a UUID intact — it is the identifier the log is built on", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(redactString(`resource ${uuid}`)).toContain(uuid);
  });
});

describe("redaction bounds the size of an event", () => {
  it("truncates a long string", () => {
    const redacted = redactString("a".repeat(5_000));
    expect(redacted.length).toBeLessThan(MAX_STRING_LENGTH + 40);
  });

  it("caps object breadth, array length and nesting depth", () => {
    const wide = Object.fromEntries(
      Array.from({ length: MAX_OBJECT_KEYS + 25 }, (_, index) => [`k${index}`, index]),
    );
    expect(Object.keys(redactMetadata(wide) ?? {}).length).toBeLessThanOrEqual(
      MAX_OBJECT_KEYS + 1,
    );

    const longArray = redactMetadata({ items: Array.from({ length: 200 }, (_, i) => i) });
    expect((longArray?.items as unknown[]).length).toBeLessThanOrEqual(MAX_ARRAY_ITEMS + 1);

    const deep = redactMetadata({ a: { b: { c: { d: { e: "too deep" } } } } });
    expect(JSON.stringify(deep)).not.toContain("too deep");
  });

  it("collapses an Error to its name rather than serializing its message", () => {
    const redacted = redactMetadata({
      failure: new Error("duplicate key value violates constraint on owner@example.com"),
    });
    expect(redacted).toEqual({ failure: "Error" });
  });

  it("returns null instead of throwing on a circular object", () => {
    const circular: Record<string, unknown> = { action: "test" };
    circular.self = circular;
    expect(() => redactMetadata(circular)).not.toThrow();
  });
});

/* ------------------------------------------------------- correlation id --- */

describe("correlation identifier", () => {
  it("mints the fixed 32-hex shape", () => {
    const id = createCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(isCorrelationId(id)).toBe(true);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createCorrelationId()));
    expect(ids.size).toBe(500);
  });

  it("refuses anything that could inject into a log line", () => {
    /*
     * The header is client-settable. A newline is a forged extra JSON record;
     * an escape sequence is a terminal hijack; an oversized value is a log
     * flood. All three are rejected by shape, not sanitized.
     */
    for (const hostile of [
      "abc\n{\"log\":\"security\"}",
      "[31mred",
      "a".repeat(10_000),
      "../../etc/passwd",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
      "",
      null,
      undefined,
    ]) {
      expect(normalizeCorrelationId(hostile as string)).toBeNull();
    }
  });

  it("accepts a well-formed value and normalizes its case", () => {
    const id = createCorrelationId().toUpperCase();
    expect(normalizeCorrelationId(id)).toBe(id.toLowerCase());
  });

  it("is stamped by the proxy and never adopted from the caller", () => {
    const proxy = read("src/proxy.ts");

    /* Minted server-side, then SET (not appended, not read) on the forwarded request. */
    expect(proxy).toContain("createCorrelationId()");
    expect(proxy).toContain(`requestHeaders.set(CORRELATION_HEADER, correlationId)`);

    /* Nothing in the proxy reads an inbound value of this header. */
    expect(proxy).not.toMatch(/headers\.get\(\s*CORRELATION_HEADER/);
    expect(proxy).not.toMatch(/request\.headers\.get\(["']x-wolf-forge-request-id/);
  });

  it("reaches the log record when the request carries it", async () => {
    const id = createCorrelationId();
    mockCorrelationHeader = id;

    await observeActionFailure(new DatabaseError(new Error("boom")), {
      action: "test.correlation",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.correlation_id).toBe(id);
  });

  it("omits the field rather than inventing one when the request has none", async () => {
    mockCorrelationHeader = null;

    await observeActionFailure(new DatabaseError(new Error("boom")), {
      action: "test.correlation",
    });

    expect(captured[0]).not.toHaveProperty("correlation_id");
  });

  it("refuses a forged header value even if the proxy were bypassed", async () => {
    mockCorrelationHeader = "not-a-correlation-id\ninjected";

    await observeActionFailure(new DatabaseError(new Error("boom")), {
      action: "test.correlation",
    });

    expect(captured[0]).not.toHaveProperty("correlation_id");
    expect(serialized()).not.toContain("injected");
  });

  it("names the header consistently across the domain and the proxy", () => {
    expect(CORRELATION_HEADER).toBe("x-wolf-forge-request-id");
    expect(read("src/proxy.ts")).toContain("CORRELATION_HEADER");
  });
});

/* ------------------------------------------------------- record shape ----- */

describe("the log record shape is the primary control", () => {
  it("derives category and severity from the code, not the call site", () => {
    const record = buildSecurityLogRecord({ event: "abuse.rate_limited" });
    expect(record).toMatchObject({
      log: "security",
      v: 1,
      event: "abuse.rate_limited",
      category: "abuse",
      severity: "warn",
    });
    expect(record?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("drops an actor identifier that is not a server-derived UUID", () => {
    /*
     * The realistic accident is passing the login form's email. It must produce
     * NO actor rather than an address in the log.
     */
    const record = buildSecurityLogRecord({
      event: "auth.login.failed",
      actorId: "owner@wolfforge.example",
    });

    expect(record).not.toHaveProperty("actor_id");
    expect(JSON.stringify(record)).not.toContain("wolfforge.example");
  });

  it("keeps a real UUID actor", () => {
    const record = buildSecurityLogRecord({
      event: "auth.login.succeeded",
      actorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      actorClass: "internal",
    });

    expect(record?.actor_id).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(record?.actor_class).toBe("internal");
  });

  it("refuses a resource type or provider that is not a bounded token", () => {
    const record = buildSecurityLogRecord({
      event: "system.unexpected_error",
      resourceType: "Invoice\nlog: forged",
      provider: "google; DROP",
    });

    expect(record).not.toHaveProperty("resource_type");
    expect(record).not.toHaveProperty("provider");
  });

  it("returns nothing at all for an unknown event code", () => {
    expect(
      buildSecurityLogRecord({ event: "auth.login.imaginary" as never }),
    ).toBeNull();
  });

  it("passes every metadata value through the redactor", () => {
    const record = buildSecurityLogRecord({
      event: "system.unexpected_error",
      metadata: {
        action: "test",
        password: "hunter2",
        detail: "token ya29.a0AfH6SMBx1234567890abcdefghij expired",
      },
    });

    const text = JSON.stringify(record);
    expect(record?.metadata?.action).toBe("test");
    expect(record?.metadata?.password).toBe(REDACTED);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ya29.");
  });

  it("has no field capable of carrying a request, a body or headers", () => {
    /*
     * The type has no such field, so this is asserted on the source: someone
     * adding `body` or `headers` to the record has to change this test too.
     */
    const source = read("src/lib/security/security-log.ts");
    expect(source).not.toMatch(/readonly (body|headers|cookies|request|payload)\??:/);
  });
});

/* ------------------------------------------------------ fail-safe logger -- */

describe("the logger fails safely", () => {
  it("swallows a sink that throws", () => {
    setSecurityLogSink(() => {
      throw new Error("drain unavailable");
    });

    expect(() =>
      recordSecurityEvent({ event: "system.unexpected_error", metadata: { action: "x" } }),
    ).not.toThrow();
  });

  it("swallows metadata that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      recordSecurityEvent({ event: "system.unexpected_error", metadata: circular }),
    ).not.toThrow();
  });

  it("returns nothing a caller could branch on", () => {
    expect(recordSecurityEvent({ event: "auth.logout" })).toBeUndefined();
  });

  it("writes through a stream rather than console, so nothing can patch it away", () => {
    const source = read("src/lib/security/security-log.ts");
    expect(source).toMatch(/process\.stdout\b/);
    expect(source).toMatch(/process\.stderr\b/);
    expect(source).toMatch(/stream\.write\(/);
    expect(source).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/);
  });
});

/* ------------------------------------------------- failure classification - */

describe("expected failures are not filed as system failures", () => {
  it("classifies the application error taxonomy into three distinct classes", () => {
    expect(classifyApplicationErrorCode("VALIDATION_ERROR")).toBe("expected");
    expect(classifyApplicationErrorCode("NOT_FOUND")).toBe("expected");
    expect(classifyApplicationErrorCode("CONFLICT")).toBe("expected");
    expect(classifyApplicationErrorCode("PERMISSION_DENIED")).toBe("security_signal");
    expect(classifyApplicationErrorCode("RATE_LIMITED")).toBe("security_signal");
    expect(classifyApplicationErrorCode("DATABASE_ERROR")).toBe("system_error");
  });

  it("classifies a Team Slow Mode refusal as expected, not a security signal — it is normal, self-selected chat pacing, not a probe", () => {
    expect(classifyApplicationErrorCode("SLOW_MODE_ACTIVE")).toBe("expected");
  });

  for (const error of [
    new ValidationError("Check the highlighted fields."),
    new NotFoundError("Invoice"),
    new ConflictError(),
  ]) {
    it(`emits no event at all for ${error.name}`, async () => {
      const safe = await observeActionFailure(error, { action: "test.expected" });

      expect(captured).toHaveLength(0);
      /* The user-visible result is unchanged by the absence of an event. */
      expect(safe.message).toBe(error.message);
    });
  }

  it("records an expected failure only when the caller opts in", async () => {
    await observeActionFailure(new NotFoundError("Invoice"), {
      action: "test.expected",
      expectedEvent: "economic.payment.denied",
    });

    expect(captured[0]?.event).toBe("economic.payment.denied");
    expect(captured[0]?.failure_class).toBe("expected");
    expect(captured[0]?.severity).toBe("info");
  });

  it("files an unexpected database failure as a system error with diagnostics", async () => {
    const cause = Object.assign(new Error("connection terminated unexpectedly"), {
      code: "57P01",
    });

    await observeActionFailure(new DatabaseError(cause), {
      action: "invoice.issue",
      resourceType: "invoice",
      resourceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      event: "system.database.failed",
      category: "system",
      severity: "error",
      failure_class: "system_error",
      outcome: "failed",
      resource_type: "invoice",
    });
    expect(captured[0]?.metadata?.action).toBe("invoice.issue");
    /* Diagnostics that make it investigable, without the raw error object. */
    expect(captured[0]?.metadata?.error_name).toBe("DatabaseError");
    expect(captured[0]?.metadata?.error_code).toBe("DATABASE_ERROR");
  });

  it("keeps a raw database message out of the browser while keeping it on the server", async () => {
    const safe = await observeActionFailure(
      new DatabaseError(new Error("relation \"private.rate_limit_counters\" does not exist")),
      { action: "test.system" },
    );

    /* Client-safe message is the generic one. */
    expect(safe.message).toBe("The database operation failed.");
    expect(safe.message).not.toContain("rate_limit_counters");
    /* Server side keeps something to work with. */
    expect(captured[0]?.metadata).toHaveProperty("detail");
  });
});

/* ------------------------------------------------ rate-limit observability */

describe("rate-limit denial produces a signal without exposing bucket internals", () => {
  it("files WF429 as an abuse signal naming only the action", async () => {
    mockCorrelationHeader = createCorrelationId();

    await observeActionFailure(new RateLimitedError(), {
      action: "profile.avatar_upload",
      actorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      actorClass: "self_service",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      event: "abuse.rate_limited",
      category: "abuse",
      severity: "warn",
      failure_class: "security_signal",
      outcome: "denied",
      actor_class: "self_service",
    });
    expect(captured[0]?.metadata?.action).toBe("profile.avatar_upload");
    expect(captured[0]?.correlation_id).toBe(mockCorrelationHeader);
  });

  it("never records a bucket, scope, window, limit or subject", async () => {
    await observeActionFailure(new RateLimitedError(), { action: "store.purchase" });

    /*
     * Structural first: the metadata carries the ACTION and the application
     * error code and nothing else. A substring sweep on its own would pass for
     * the wrong reason if the field had simply never been populated.
     */
    expect(Object.keys(captured[0]?.metadata ?? {}).sort()).toEqual(["action", "error_code"]);

    /*
     * Then by content, over everything EXCEPT the event code itself:
     * `abuse.rate_limited` legitimately contains the word "limit", and the
     * question this test asks is whether any bucket detail escaped beside it.
     */
    const record = { ...(captured[0] ?? {}) } as Record<string, unknown>;
    delete record.event;
    const text = JSON.stringify(record);

    for (const forbidden of [
      "bucket",
      "scope",
      "window",
      "limit",
      "counter",
      "consume_rate_limit",
      "rate_limit_counters",
      "avatar.upload.claim",
      "profile.selfservice",
      "invoice.pay.actor",
      "coupon.attempt.actor",
    ]) {
      expect(`${forbidden}:${text.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  it("observes the one anonymous mutation surface without logging its answers", async () => {
    const forms = read("src/app/actions/forms.ts");

    /* The anon-reachable public Form submission is wired. */
    expect(forms).toMatch(
      /submitPublicFormAction[\s\S]*?observeActionFailure\(error, \{[\s\S]*?action: "form\.submit_public"/,
    );
    /* Respondent-authored text is never handed to the logger. */
    expect(forms).not.toMatch(/observeActionFailure\([\s\S]{0,400}?\b(values|files|answers|parsed\.values)\b/);

    /* And an anonymous throttle still resolves to the generic abuse signal. */
    await observeActionFailure(new RateLimitedError(), {
      action: "form.submit_public",
      actorClass: "anonymous",
    });

    expect(captured[0]).toMatchObject({
      event: "abuse.rate_limited",
      actor_class: "anonymous",
    });
    expect(captured[0]).not.toHaveProperty("actor_id");
  });

  it("keeps the client-facing throttle message generic", () => {
    /* Unchanged from C2-3; re-pinned here because C2-4 touches these paths. */
    expect(new RateLimitedError().message).toBe(
      "Too many requests. Please wait a moment and try again.",
    );
  });
});

/* --------------------------------------------- authorization observability */

describe("authorization denial is observable", () => {
  it("files a permission refusal as a capability denial", async () => {
    await observeActionFailure(new PermissionDeniedError(), {
      action: "invoice.void",
      actorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      actorClass: "internal",
    });

    expect(captured[0]).toMatchObject({
      event: "authorization.capability.denied",
      category: "authorization",
      severity: "warn",
      failure_class: "security_signal",
      outcome: "denied",
    });
  });

  it("distinguishes a logged-out visitor from a wrong-surface actor", () => {
    const source = read("src/lib/supabase/next-server.ts");

    /* All three refusals exist and are separate codes. */
    expect(source).toContain("authorization.context.unauthenticated");
    expect(source).toContain("auth.session.unverified");
    expect(source).toContain("authorization.context.denied");

    /* The interesting one — verified actor, wrong surface — carries the actor. */
    expect(source).toMatch(/event: "authorization\.context\.denied",[\s\S]{0,120}actorId: actor\.id/);
  });

  it("records every context refusal before redirecting away", () => {
    const source = read("src/lib/supabase/next-server.ts");
    /* `redirect()` throws, so an unawaited record would be lost. */
    const refusals = source.match(/await recordContextRefusal\(/g) ?? [];
    expect(refusals.length).toBe(8);
  });
});

/* ------------------------------------------------- login / KI-029 posture -- */

describe("login failure classification (KI-029 observability)", () => {
  it("separates a provider throttle from an ordinary credential failure", () => {
    expect(classifySignInFailure({ code: "over_request_rate_limit", status: 429 })).toBe(
      "rate_limited",
    );
    expect(classifySignInFailure({ code: "invalid_credentials", status: 400 })).toBe(
      "credentials",
    );
  });

  it("treats HTTP 429 as a throttle even if the provider renames its code", () => {
    expect(classifySignInFailure({ code: "some_future_spelling", status: 429 })).toBe(
      "rate_limited",
    );
  });

  it("treats an unknown non-4xx provider failure as a provider error", () => {
    expect(classifySignInFailure({ code: "internal_error", status: 500 })).toBe(
      "provider_error",
    );
  });

  it("treats a missing session with no error as a credential failure", () => {
    expect(classifySignInFailure(null)).toBe("credentials");
    expect(classifySignInFailure(undefined)).toBe("credentials");
  });

  it("passes through only a bounded machine token as the provider code", () => {
    expect(safeProviderCode({ code: "over_request_rate_limit" })).toBe(
      "over_request_rate_limit",
    );
    /* Prose, addresses and injected newlines are refused outright. */
    expect(safeProviderCode({ code: "no user found for owner@example.com" })).toBeNull();
    expect(safeProviderCode({ code: "abc\ndef" })).toBeNull();
    expect(safeProviderCode({ code: "x".repeat(200) })).toBeNull();
    expect(safeProviderCode({})).toBeNull();
  });

  it("wires the three login outcomes into the sign-in action", () => {
    const source = read("src/app/actions/auth.ts");

    expect(source).toContain("classifySignInFailure");
    expect(source).toContain('credentials: "auth.login.failed"');
    expect(source).toContain('rate_limited: "auth.login.rate_limited"');
    expect(source).toContain('provider_error: "auth.login.provider_error"');
    expect(source).toContain("auth.login.unassigned");
    expect(source).toContain("auth.login.succeeded");
  });

  it("still gives the browser one non-enumerating message", () => {
    const source = read("src/app/actions/auth.ts");

    /*
     * The production login hardening pass added early refusal branches
     * (oversized input, bot detection, limiter preflight failure) ahead of
     * the credential check itself — each must ALSO give the browser the
     * exact same uniform message, so each legitimately has its own
     * `return signInFailure(...)` call site. What must never happen is a
     * second, different wording: every failure return in this action funnels
     * through the shared `signInFailure` / `signInUnassigned` helpers, with
     * no ad-hoc `return { error: ... }` literal anywhere else.
     */
    expect(source.match(/return signInFailure\(/g)?.length).toBeGreaterThanOrEqual(1);
    const bareErrorReturns = source.match(/return \{\s*error:/g) ?? [];
    expect(bareErrorReturns).toHaveLength(0);
    /* No provider wording reaches the response or the log. */
    expect(source).not.toMatch(/error\.message/);
    expect(source).not.toMatch(/metadata:\s*\{[^}]*\bemail\b/);
    /*
     * The unassigned refusal is the only other failure return, and it is the
     * POST-authentication message — safe to distinguish, because reaching it
     * required already proving the password (see `login-flow.ts`).
     */
    expect(source.match(/return signInUnassigned\(\)/g)).toHaveLength(1);
  });

  it("never puts the submitted email or password into an event", () => {
    const source = read("src/app/actions/auth.ts");
    /*
     * Non-greedy to the first `});` that closes at the start of a line — a
     * nested object closes with `},` and cannot terminate the match early.
     */
    const events = source.match(/recordSecurityEvent\(\{[\s\S]*?\n\s*\}\);/g) ?? [];

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).not.toMatch(/\bemail\b/);
      expect(event).not.toMatch(/\bpassword\b/);
      expect(event).not.toMatch(/access_token/);
    }
  });
});

/* --------------------------------------------- integration observability -- */

describe("Gmail / OAuth observability leaks no provider material", () => {
  const gmailRoute = (name: string) =>
    `src/app/(internal)/settings/integrations/gmail/${name}/route.ts`;

  const callbackRoute = gmailRoute("callback");
  const verifyRoute = gmailRoute("verify");
  const stateChangingRoutes = [gmailRoute("connect"), verifyRoute, gmailRoute("disconnect")];
  const routes = [callbackRoute, ...stateChangingRoutes];

  it("gives the state mismatch its own code", () => {
    const source = read(callbackRoute);
    expect(source).toContain("integration.gmail.oauth_state_mismatch");
    expect(source).toContain("integration.gmail.oauth_provider_denied");
    expect(source).toContain("integration.gmail.oauth_callback_invalid");
  });

  it("gives an invalid_grant refresh its own code", () => {
    const source = read(verifyRoute);
    expect(source).toContain("integration.gmail.reauthorization_required");
    expect(source).toContain("GmailReauthorizationRequiredError");
  });

  it("never passes a code, state, verifier or token to the logger", () => {
    for (const route of [...routes, "src/lib/integrations/gmail-observability.ts"]) {
      const source = read(route);
      const calls = source.match(/record(SecurityEvent|Gmail\w+)\(\{[\s\S]*?\}\)/g) ?? [];

      for (const call of calls) {
        expect(`${route}: ${/validation\.code/.test(call)}`).toBe(`${route}: false`);
        expect(`${route}: ${/\bverifier\b/.test(call)}`).toBe(`${route}: false`);
        expect(`${route}: ${/accessToken|refreshToken|refresh_token|access_token/.test(call)}`).toBe(
          `${route}: false`,
        );
        expect(`${route}: ${/searchParams\.get/.test(call)}`).toBe(`${route}: false`);
      }
    }
  });

  it("offers no logging parameter that could carry provider material", () => {
    const helper = read("src/lib/integrations/gmail-observability.ts");
    expect(helper).not.toMatch(/\b(code|state|token|verifier|email)\??:/);
  });

  it("rejects a foreign origin with its own authorization code", () => {
    /*
     * The callback is exempt: it is a GET the provider redirects the browser
     * into, so it is protected by the state cookie rather than by Origin.
     */
    for (const route of stateChangingRoutes) {
      expect(read(route)).toContain("recordGmailOriginRejected");
    }
  });

  it("does not log the rejected origin value itself", () => {
    const helper = read("src/lib/integrations/gmail-observability.ts");
    expect(helper).not.toMatch(/origin:\s*[^"']/);
  });
});

/* ------------------------------------------------ economic observability -- */

describe("economic failure observability", () => {
  it("separates an expected money refusal from an unexpected one", () => {
    const purchase = read("src/app/actions/store-purchase.ts");
    const payment = read("src/app/actions/wf-card.ts");

    expect(purchase).toContain("economic.purchase.denied");
    expect(purchase).toContain("economic.purchase.failed");
    expect(payment).toContain("economic.payment.denied");
    expect(payment).toContain("economic.payment.failed");
  });

  it("records a rate-limited purchase as an abuse signal, not a payment failure", () => {
    expect(read("src/app/actions/store-purchase.ts")).toContain('event: "abuse.rate_limited"');
  });

  it("never records browser-supplied economics as truth", () => {
    for (const file of ["src/app/actions/store-purchase.ts", "src/app/actions/wf-card.ts"]) {
      const source = read(file);
      const events = source.match(/recordSecurityEvent\(\{[\s\S]*?\n\s*\}\);/g) ?? [];

      for (const event of events) {
        /*
         * The authoritative amounts live inside the transaction that just
         * rolled back; anything the browser sent is a request, not a fact.
         */
        expect(event).not.toMatch(/amountCents|walletBalanceCents|amount_cents|price/);
      }
    }
  });
});

/* ---------------------------------------------------- console-log audit --- */

describe("console / raw request logging audit", () => {
  /*
   * Read ONCE. Four separate sweeps re-reading ~800 files each is slow enough
   * to time out when the whole security batch runs in parallel, and a control
   * suite that flakes under load stops being a control.
   */
  const productionSources = collectSourceFiles().map(
    (file) => [file, read(file)] as const,
  );

  it("has no console diagnostics outside the two React error boundaries", () => {
    const offenders = productionSources
      .filter(
        ([file, source]) =>
          !file.endsWith("error.tsx") &&
          /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/.test(source),
      )
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it("keeps the error boundaries' console.error, which never prints the message", () => {
    /*
     * KEEP, and justified (D-110): these are CLIENT components, so the
     * server-only security logger cannot run there, and the browser console is
     * the only diagnostic channel that exists. Neither renders the caught
     * error's message, stack or digest — that is pinned by
     * `security-controls.test.ts`.
     */
    for (const boundary of ["src/app/error.tsx", "src/app/(internal)/error.tsx"]) {
      expect(read(boundary)).toContain("console.error(error)");
    }
  });

  it("writes to stdout/stderr from exactly one module", () => {
    const offenders = productionSources
      .filter(
        ([file, source]) =>
          !file.endsWith("lib/security/security-log.ts") &&
          /process\.(stdout|stderr)\.write/.test(source),
      )
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it("never serializes a whole request, body, header map or form payload", () => {
    /*
     * The record type has no field for any of these, so this is a belt on top
     * of that brace: it catches someone spreading a request or stringifying a
     * FormData INTO the metadata bag, which the type alone would allow.
     */
    const offenders = productionSources
      .filter(([, source]) =>
        /recordSecurityEvent\([\s\S]{0,400}?(JSON\.stringify\(\s*(request|formData|body|headers)|\.\.\.request\b|\.\.\.formData\b|await request\.(json|text|formData)\()/.test(
          source,
        ),
      )
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it("allows only the approved Sentry monitoring vendor", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(installed).toContain("@sentry/nextjs");

    for (const vendor of ["datadog", "dd-trace", "newrelic", "logrocket", "posthog"]) {
      expect(
        `${vendor}: ${installed.some((name) => name.toLowerCase().includes(vendor))}`,
      ).toBe(`${vendor}: false`);
    }
  });

  it("keeps the external sink a seam rather than a dependency", () => {
    const source = read("src/lib/security/security-log.ts");
    expect(source).toContain("setSecurityLogSink");
    expect(source).not.toMatch(/\bfetch\(|https?:\/\//);
  });
});

/* ------------------------------------------------------------- helpers ---- */

function collectSourceFiles(): string[] {
  const files: string[] = [];

  const walk = (relative: string) => {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        /* Tests and scripts are exempt: diagnostics there are the point. */
        if (entry.name === "tests") continue;
        walk(next);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) files.push(next);
    }
  };

  walk("src");
  return files;
}
