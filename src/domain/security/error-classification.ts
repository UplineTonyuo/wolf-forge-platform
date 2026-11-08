/**
 * Failure classification. Pure, so both the logger and its tests can reason
 * about "what KIND of failure was that" without touching a database, a
 * provider or a request.
 *
 * ## Why this exists
 *
 * Before this module the platform had exactly two states for a failure: the
 * user saw a safe message, and nothing anywhere recorded which of three very
 * different things had just happened.
 *
 *   EXPECTED        A validation failure, a not-found, an insufficient balance,
 *                   an idempotent replay. The system worked. Logging these as
 *                   errors trains everyone to ignore the error stream, which is
 *                   how a real incident gets missed.
 *
 *   SECURITY SIGNAL A control refused something: a permission gate, a throttle.
 *                   Individually mundane, collectively the whole point of
 *                   monitoring — this is what a probe or a stuffing run looks
 *                   like from the inside.
 *
 *   SYSTEM ERROR    Something failed that was not supposed to be able to fail.
 *                   An unexpected SQLSTATE, a provider outage, a broken
 *                   invariant. These are the ones that should wake someone.
 *
 * The three are deliberately NOT collapsed. A system error that is filed as an
 * expected failure is an outage nobody sees; an expected failure filed as a
 * system error is noise that buries the outage.
 */

import type { ApplicationErrorCode } from "../../lib/errors/application-error";

export type FailureClass = "expected" | "security_signal" | "system_error";

/**
 * Maps the application's own error taxonomy onto the three classes.
 *
 * `RATE_LIMITED` is a security signal rather than an expected failure on
 * purpose: the same request would have succeeded a moment earlier, so its
 * presence says something about the CALLER, not about the request.
 *
 * `SLOW_MODE_ACTIVE` is `expected`, not a security signal, even though it is
 * also a throttle: a Team conversation's owner/admin deliberately turned
 * Slow Mode on, and every ordinary participant who then gets paced by it is
 * the product working exactly as configured — not a probe or a stuffing run.
 * Filing it as a security signal would flood monitoring with normal chat
 * pacing in any conversation that uses the feature, which is the same
 * noise-burying-the-real-signal failure mode this module exists to avoid.
 *
 * `DATABASE_ERROR` is the default arm of `mapDatabaseError`, i.e. every
 * SQLSTATE nobody has modelled. That is exactly what "unexpected" means.
 */
export function classifyApplicationErrorCode(code: ApplicationErrorCode): FailureClass {
  switch (code) {
    case "VALIDATION_ERROR":
    case "NOT_FOUND":
    case "CONFLICT":
    case "SLOW_MODE_ACTIVE":
    case "REPORT_REQUIRED":
      return "expected";
    case "PERMISSION_DENIED":
    case "RATE_LIMITED":
      return "security_signal";
    case "DATABASE_ERROR":
      return "system_error";
    default: {
      /* Exhaustiveness: a new code must make a deliberate choice here. */
      const unhandled: never = code;
      void unhandled;
      return "system_error";
    }
  }
}

export type SignInFailureClass = "credentials" | "rate_limited" | "provider_error";

/**
 * Supabase Auth error codes that mean "the credential stage refused you".
 *
 * All of them collapse to ONE message in the browser (`login-flow.ts`), and
 * that is not changed by classifying them here — this classification never
 * leaves the server.
 */
const CREDENTIAL_STAGE_CODES: readonly string[] = Object.freeze([
  "invalid_credentials",
  "invalid_grant",
  "bad_password",
  "email_not_confirmed",
  "phone_not_confirmed",
  "user_not_found",
  "validation_failed",
]);

/**
 * Provider throttle codes. `over_request_rate_limit` is the KI-029 one: because
 * every `signInWithPassword` reaches Supabase Auth from the application
 * server's egress IP, this bucket is shared by every legitimate user at once,
 * and a busy sign-in period is indistinguishable in the UI from a wrong
 * password.
 */
const RATE_LIMIT_CODES: readonly string[] = Object.freeze([
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
]);

interface ProviderErrorLike {
  code?: unknown;
  status?: unknown;
}

function providerCode(error: unknown): string | null {
  const code = (error as ProviderErrorLike | null)?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function providerStatus(error: unknown): number | null {
  const status = (error as ProviderErrorLike | null)?.status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/**
 * Which of the three shapes a sign-in failure had.
 *
 * A NULL/absent error classifies as `credentials`: `isCredentialStageFailure`
 * treats "no error but no session either" as a failure, and there is nothing
 * provider-specific to report about it.
 *
 * HTTP 429 is honoured independently of the code because the provider has
 * shipped more than one spelling of its throttle over time, and being wrong in
 * that direction would silently re-hide exactly the signal this exists for.
 */
export function classifySignInFailure(error: unknown): SignInFailureClass {
  if (!error) return "credentials";

  const code = providerCode(error);
  if (code && RATE_LIMIT_CODES.includes(code)) return "rate_limited";
  if (providerStatus(error) === 429) return "rate_limited";
  if (code && CREDENTIAL_STAGE_CODES.includes(code)) return "credentials";
  if (providerStatus(error) === 400 || providerStatus(error) === 401) return "credentials";

  return "provider_error";
}

/**
 * The provider's own error code, but only when it is a bounded machine token.
 *
 * Supabase Auth codes are a fixed vocabulary (`invalid_credentials`,
 * `over_request_rate_limit`, …) and carry nothing about which account was
 * tried, so they are safe and genuinely useful. Anything that is not a short
 * snake-case token is refused rather than trimmed — a provider that starts
 * putting prose (or an address) in `code` must not be able to smuggle it into
 * the log through this door.
 */
export function safeProviderCode(error: unknown): string | null {
  const code = providerCode(error);
  if (!code) return null;
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : null;
}
