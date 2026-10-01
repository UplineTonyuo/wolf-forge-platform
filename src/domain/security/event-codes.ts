/**
 * Security event codes — the stable, machine-readable classification for every
 * security signal this platform emits. Pure: no I/O, no server-only import, so
 * the taxonomy is testable and can be referenced from anywhere.
 *
 * ## Why codes and not messages
 *
 * A log line whose only classification is English prose cannot be queried,
 * alerted on, or counted. Wording drifts with every refactor; a code does not.
 * `recordSecurityEvent` therefore takes a code from this file and nothing else
 * — there is no free-form `message` field anywhere in the record shape.
 *
 * ## Naming
 *
 * `<category>.<subject>.<outcome>` in lower snake segments. The first segment
 * always matches the declared category, which `security-monitoring.test.ts`
 * asserts, so a code cannot quietly land in the wrong bucket.
 *
 * ## Severity
 *
 * Severity belongs to the CODE, not the call site. Two call sites emitting the
 * same code must produce the same severity or a dashboard built on it lies.
 *
 *   info   something happened that is worth being able to reconstruct later
 *          (a session began, a password changed, an expected refusal fired)
 *   warn   a control refused something — the system behaved correctly, and the
 *          pattern of these is the thing worth watching
 *   error  something failed that was not supposed to be able to fail
 */

export type SecuritySeverity = "info" | "warn" | "error";

export type SecurityEventCategory =
  | "authentication"
  | "authorization"
  | "abuse"
  | "economic"
  | "integration"
  | "system";

export interface SecurityEventDefinition {
  readonly category: SecurityEventCategory;
  readonly severity: SecuritySeverity;
}

/**
 * Every event this application may emit.
 *
 * Adding a code here is a deliberate act: it is the one place the taxonomy
 * lives, and the record shape refuses anything that is not a key of this map.
 *
 * The category prefix is `auth` for `authentication` — the one abbreviation,
 * because `authentication.login.failed` reads worse than it classifies. The
 * prefix map in `securityEventPrefix` is what the test asserts against.
 */
export const SECURITY_EVENTS = {
  /* ---------------------------------------------------------------- auth -- */

  "auth.login.succeeded": { category: "authentication", severity: "info" },

  /**
   * An ordinary credential-stage failure. Deliberately `info`: a wrong password
   * is a daily event and is not, by itself, a signal. What matters is the RATE,
   * which is a query over these lines, not a property of any one of them.
   */
  "auth.login.failed": { category: "authentication", severity: "info" },

  /**
   * Supabase Auth refused the attempt with `over_request_rate_limit`.
   *
   * This is the KI-029 signal and it is a large part of why this phase exists.
   * The browser is told the same non-enumerating "that email and password
   * don't match" as an ordinary failure — that property is not negotiable — so
   * WITHOUT this event a platform-wide login outage is indistinguishable from a
   * user mistyping a password. Here it is a distinct, countable code.
   */
  "auth.login.rate_limited": { category: "authentication", severity: "warn" },

  /** Vercel BotID refused an automated login before Auth or Postgres work. */
  "auth.login.bot_blocked": { category: "authentication", severity: "warn" },

  /** Distributed failures are targeting one normalized identity; no hard lock. */
  "auth.login.identity_targeted": { category: "authentication", severity: "warn" },

  /** The provider failed in a way that is neither credentials nor a throttle. */
  "auth.login.provider_error": { category: "authentication", severity: "error" },

  /**
   * The password was correct but the account holds no internal role and no
   * active client assignment. Safe to distinguish and worth seeing: it is what
   * a de-provisioned or half-provisioned account looks like from outside.
   */
  "auth.login.unassigned": { category: "authentication", severity: "warn" },

  "auth.logout": { category: "authentication", severity: "info" },

  /**
   * A session cookie was present but `verifyActor()` refused it. In normal
   * operation this is an expired token; in abnormal operation it is a forged
   * one, and the two are indistinguishable from here — hence `warn`.
   */
  "auth.session.unverified": { category: "authentication", severity: "warn" },

  "auth.password.changed": { category: "authentication", severity: "info" },
  /** Wrong current password, or a policy rejection. Expected, but auditable. */
  "auth.password.rejected": { category: "authentication", severity: "info" },
  "auth.password.rate_limited": { category: "authentication", severity: "warn" },
  "auth.password.provider_error": { category: "authentication", severity: "error" },

  /* ------------------------------------------------------- authorization -- */

  /**
   * A protected surface was reached with no usable session. Extremely common
   * (every bookmark opened after a session expires), so it is `info` and exists
   * only to make a sweep of protected URLs visible as a burst.
   */
  "authorization.context.unauthenticated": { category: "authorization", severity: "info" },

  /**
   * An AUTHENTICATED actor was refused a surface that is not theirs — a client
   * account reaching the staff application, or staff-only context resolving for
   * an account with no internal role. This is the cross-surface access attempt,
   * and it is materially more interesting than simply being logged out.
   */
  "authorization.context.denied": { category: "authorization", severity: "warn" },

  /** A supervisor successfully accessed privileged Team conversation content. */
  "authorization.team_supervision.read": { category: "authorization", severity: "info" },

  /** A capability/permission gate refused a specific operation. */
  "authorization.capability.denied": { category: "authorization", severity: "warn" },

  /** A state-changing request arrived without the expected same-origin header. */
  "authorization.origin.rejected": { category: "authorization", severity: "warn" },

  /* ------------------------------------------------------------- abuse ---- */

  /**
   * A server-enforced throttle refused the call (SQLSTATE WF429, or a provider
   * throttle mapped onto it). The record names the ACTION, never the bucket,
   * scope, window, limit or subject — see `security-log.ts`.
   */
  "abuse.rate_limited": { category: "abuse", severity: "warn" },

  /* ---------------------------------------------------------- economic --- */

  /** An expected money refusal: insufficient balance, not collectible, unpriced. */
  "economic.purchase.denied": { category: "economic", severity: "info" },
  "economic.payment.denied": { category: "economic", severity: "info" },
  /** A money path failed for a reason the domain does not model. */
  "economic.purchase.failed": { category: "economic", severity: "error" },
  "economic.payment.failed": { category: "economic", severity: "error" },

  /* ------------------------------------------------------- integration --- */

  /**
   * The OAuth `state` did not match the callback-scoped cookie, or the PKCE
   * verifier was missing. Either is a failed CSRF / authorization-code
   * injection attempt or a badly stale tab, and both deserve to be visible.
   */
  "integration.gmail.oauth_state_mismatch": { category: "integration", severity: "warn" },
  /** Google returned `?error=` — the operator declined consent, or Google did. */
  "integration.gmail.oauth_provider_denied": { category: "integration", severity: "warn" },
  /** State matched but the callback carried no authorization code. */
  "integration.gmail.oauth_callback_invalid": { category: "integration", severity: "warn" },
  /**
   * The OAuth exchange succeeded and the platform-level Gmail connection is
   * now `connected`. Added for Security C2-5: a lifecycle SUCCESS changes
   * external credential state, which is exactly what a durable audit trail
   * must be able to reconstruct ("when was this provider connected, and by
   * whom"). C2-4 needed only failures, so this code did not exist yet.
   */
  "integration.gmail.connected": { category: "integration", severity: "info" },
  "integration.gmail.connect_failed": { category: "integration", severity: "error" },
  /**
   * The stored credential was removed and Google's grant was revoked. The
   * mirror image of `connected`, and audit-worthy for the same reason.
   */
  "integration.gmail.disconnected": { category: "integration", severity: "info" },
  /** `invalid_grant` on refresh, or an identity that no longer matches. */
  "integration.gmail.reauthorization_required": { category: "integration", severity: "warn" },
  "integration.gmail.verify_failed": { category: "integration", severity: "error" },
  /**
   * Disconnect did not complete cleanly. Security-significant enough to be
   * durable: it can leave a live Google grant that the UI already reports as
   * gone, or a local credential for a grant that no longer exists.
   */
  "integration.gmail.disconnect_failed": { category: "integration", severity: "error" },
  /** A Gmail route was reached while the OAuth environment is not configured. */
  "integration.gmail.not_configured": { category: "integration", severity: "warn" },

  /**
   * The Podcast SEO Google Sheets read failed — missing config, a token/JWT
   * problem, a Sheets API error, tab detection, or an unexpected shape. The
   * pipeline stage and a machine error code live in metadata; never the
   * credential, the spreadsheet id, or a sheet's row contents.
   */
  "integration.podcast_sheets.fetch_failed": { category: "integration", severity: "warn" },

  /** A signed Apps Script change notification was accepted and a refetch was triggered. */
  "integration.podcast_sync.accepted": { category: "integration", severity: "info" },
  /** A Podcast SEO sync webhook call was refused — bad/missing signature, stale timestamp, bad shape, or wrong event type. */
  "integration.podcast_sync.rejected": { category: "integration", severity: "warn" },

  /* ------------------------------------------------------------ system --- */

  /** An unexpected database/RPC failure reached an application boundary. */
  "system.database.failed": { category: "system", severity: "error" },
  /** Anything else that failed in a way the domain does not model. */
  "system.unexpected_error": { category: "system", severity: "error" },

  /**
   * A scheduled Team voice retention sweep ran to completion. Metadata holds
   * only the selected/removed/failed counts — never a storage path, message
   * id, or conversation id.
   */
  "system.team_voice_cleanup.completed": { category: "system", severity: "info" },
} as const satisfies Record<string, SecurityEventDefinition>;

export type SecurityEventCode = keyof typeof SECURITY_EVENTS;

/**
 * The code prefix that belongs to each category. `authentication` is the one
 * category whose prefix is abbreviated; everything else is its own name.
 */
export const SECURITY_EVENT_PREFIXES: Readonly<Record<SecurityEventCategory, string>> =
  Object.freeze({
    authentication: "auth",
    authorization: "authorization",
    abuse: "abuse",
    economic: "economic",
    integration: "integration",
    system: "system",
  });

export function securityEventDefinition(code: SecurityEventCode): SecurityEventDefinition {
  return SECURITY_EVENTS[code];
}

export function isSecurityEventCode(value: unknown): value is SecurityEventCode {
  return typeof value === "string" && Object.hasOwn(SECURITY_EVENTS, value);
}
