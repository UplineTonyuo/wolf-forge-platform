/**
 * Login outcome decisions — pure, no I/O.
 *
 * `signInAction` owns the Supabase calls; every DECISION it makes lives here so
 * the non-enumeration property is a testable function rather than a scattering
 * of string literals in a server action.
 *
 * ## Why the failure message is a constant
 *
 * A login form that says "no such account" for an unknown email and "wrong
 * password" for a known one is an account-enumeration oracle: an attacker
 * harvests valid addresses without ever guessing a password. Every
 * credential-stage failure — unknown email, wrong password, unconfirmed
 * address, provider rate-limit rejection, transport error — therefore collapses
 * to ONE message. There is exactly one exported constant for it and the action
 * has no other credential-failure branch.
 *
 * The post-authentication message is deliberately different and that is safe:
 * reaching it requires having already proven the password, so it reveals
 * nothing to someone who does not hold the credential.
 *
 * ## Brute-force posture (KI-022)
 *
 * Password-attempt rate limiting is PROVIDER-SIDE: Supabase Auth's per-IP
 * `sign_in_sign_ups` bucket. No application-level limiter exists, and that is a
 * decision, not an oversight — an anon-callable limiter RPC would contradict
 * the Batch B2 rule that anon can EXECUTE nothing in `private`, and throttling
 * server actions from the proxy is fragile. The consequence is recorded
 * honestly in KI-022: IP rotation bypasses the bucket, and the hosted dashboard
 * values still need human verification. Nothing in this module should ever grow
 * a per-account counter without revisiting that decision.
 */

/**
 * The ONLY message any credential-stage failure may produce. Exported so the
 * action cannot drift and so tests can assert there is no second variant.
 */
export const SIGN_IN_FAILURE_MESSAGE = "That email and password don't match an account.";

/**
 * Post-authentication refusal: the password was correct but the account has no
 * internal role and no active client assignment. Safe to distinguish — the
 * caller already proved possession of the credential.
 */
export const SIGN_IN_UNASSIGNED_MESSAGE = "This account is not active or has not been assigned yet.";

/**
 * Collapses ANY credential-stage failure to the uniform message. Takes the
 * cause only so a caller cannot accidentally pass provider text through; the
 * argument is never read into the result.
 */
export function signInFailure(cause?: unknown): { error: string } {
  // Accepted so the call site reads honestly, then discarded here — explicitly,
  // so that "the provider's wording never reaches the browser" is visible in
  // the code rather than being an absence someone might later "fix".
  void cause;
  return { error: SIGN_IN_FAILURE_MESSAGE };
}

/** The unassigned-account refusal, as the same state shape. */
export function signInUnassigned(): { error: string } {
  return { error: SIGN_IN_UNASSIGNED_MESSAGE };
}

/**
 * True when the sign-in call failed at the credential stage. A missing session
 * counts as failure even when the provider reported no error: a successful
 * response without a session is not an authenticated caller.
 */
export function isCredentialStageFailure(input: {
  error: unknown;
  session: unknown;
}): boolean {
  return Boolean(input.error) || !input.session;
}

export type SignInSurface = "internal" | "client";

/**
 * Which surface an authenticated actor belongs to. Internal wins when both
 * resolve — staff who also hold a portal assignment land in the staff
 * application, matching the existing action's ordering.
 */
export function resolveSignInSurface(input: {
  hasInternalUser: boolean;
  hasClientUser: boolean;
}): SignInSurface | null {
  if (input.hasInternalUser) return "internal";
  if (input.hasClientUser) return "client";
  return null;
}
