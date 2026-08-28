"use server";

import {
  changePasswordSchema,
  type PasswordActionState,
} from "../../domain/profile/security";
import { safeProviderCode } from "../../domain/security/error-classification";
import type { SecurityEventCode } from "../../domain/security/event-codes";
import { currentCorrelationId } from "../../lib/security/request-correlation";
import { recordSecurityAuditEvent } from "../../lib/security/security-audit-log";
import { recordSecurityEvent } from "../../lib/security/security-log";
import {
  createNextServerSupabaseClient,
  getSelfServiceContext,
} from "../../lib/supabase/next-server";

/*
 * Only async functions may be exported from a "use server" module, so the state
 * type and its initial value live in domain/profile/security.ts.
 */

function fail(error: string, fieldErrors: Record<string, string> = {}): PasswordActionState {
  return { error, fieldErrors, changedAt: null };
}

/**
 * Maps a Supabase Auth failure to wording safe to show a user.
 *
 * Raw Auth messages can name internal endpoints and policy detail, so nothing
 * from the library is passed through verbatim.
 */
function safePasswordError(code: string | undefined): string {
  if (code === "weak_password") {
    return "That password is too weak. Choose something longer or less common.";
  }

  if (code === "same_password") {
    return "Choose a password different from your current one.";
  }

  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "Too many attempts. Wait a moment and try again.";
  }

  return "Unable to update your password. Try again.";
}

/**
 * Changes the signed-in account's own password.
 *
 * Flow, and why:
 *
 *  1. `getSelfServiceContext()` establishes a server-verified actor — internal
 *     member or client account alike, since changing your own password is not
 *     a staff capability. The
 *     account's email is read from `app_get_my_profile` (server side) â€” it is
 *     never accepted from the browser, so this cannot be pointed at anyone else.
 *  2. The current password is proven by attempting a sign-in with it on a
 *     throwaway client that never persists a session. This uses only the Supabase
 *     Auth API: no password hash is read, no custom verification is performed and
 *     nothing touches an application table. supabase-js has no dedicated
 *     "verify current password" call, and the alternative â€” Supabase's
 *     reauthentication nonce â€” requires `secure_password_change = true` plus a
 *     working SMTP sender, neither of which this project currently has.
 *  3. The change itself goes through `updateUser` on the cookie-bound session
 *     client, which is the self-service Auth API. The admin API is deliberately
 *     not used anywhere in this path.
 *  4. Every other session is then revoked explicitly with `scope: "others"`
 *     rather than relying on assumptions about GoTrue's default behaviour. The
 *     caller's own session survives, so the user is not logged out of the tab
 *     they just used.
 *
 * No password value is logged, retained or returned at any point.
 */
export async function changeMyPasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  void _state;

  const parsed = changePasswordSchema.safeParse({
    current_password: String(formData.get("current_password") ?? ""),
    new_password: String(formData.get("new_password") ?? ""),
    confirm_password: String(formData.get("confirm_password") ?? ""),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }

    return fail("Check the highlighted fields.", fieldErrors);
  }

  const context = await getSelfServiceContext();
  const profile = await context.services.profile.getMine().catch(() => null);

  if (!profile?.email) {
    return fail("Your account has no email on file, so the password cannot be changed here.");
  }

  const supabase = await createNextServerSupabaseClient();

  /*
   * Supabase Auth verifies the current password and changes the credential in
   * one authenticated request. No temporary sign-in session is created.
   */
  const { error } = await supabase.auth.updateUser({
    current_password: parsed.data.current_password,
    password: parsed.data.new_password,
  });

  if (error) {
    /*
     * Security C2-4. The USER-VISIBLE wording is unchanged — a bad current
     * password still gets the field-level message and everything else still
     * gets the mapped generic one. The server additionally records which of
     * three very different things happened, because a credential-verification
     * refusal, a provider throttle and a provider outage need different
     * responses and were previously indistinguishable from outside.
     *
     * No password, no new password, no provider prose. The event carries the
     * verified actor id, which is safe: this action is self-service only and the
     * caller has already been authenticated.
     */
    const rejected = error.code === "invalid_credentials" || error.code === "bad_password";
    const throttled =
      error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit";

    const event: SecurityEventCode = rejected
      ? "auth.password.rejected"
      : throttled
        ? "auth.password.rate_limited"
        : "auth.password.provider_error";

    recordSecurityEvent({
      event,
      correlationId: await currentCorrelationId(),
      actorId: context.actor.id,
      actorClass: "self_service",
      outcome: "denied",
      metadata: {
        action: "auth.change_password",
        ...(rejected ? {} : { provider_code: safeProviderCode(error) }),
      },
    });

    /*
     * Keep authentication details private. A bad current password gets a
     * field-level message; every other Auth error goes through the existing
     * client-safe mapper.
     */
    if (rejected) {
      return fail("Check the highlighted fields.", {
        current_password: "That password is incorrect.",
      });
    }

    return fail(safePasswordError(error.code));
  }

  /* Anything signed in with the old password is now invalidated. */
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

  /*
   * A credential change is one of the few successes worth recording
   * unconditionally: it is the single most useful anchor when reconstructing an
   * account-takeover timeline, and it happens rarely enough to add no noise.
   *
   * Security C2-5. It is also THE canonical durable audit row: password
   * changes happen entirely inside Supabase Auth — no application table or RPC
   * participates — so there is no trigger that could record it and no ledger
   * that already has it. The writer derives everything from the server-verified
   * actor; a rejected attempt above deliberately persists nothing.
   */
  const correlationId = await currentCorrelationId();
  recordSecurityEvent({
    event: "auth.password.changed",
    correlationId,
    actorId: context.actor.id,
    actorClass: "self_service",
    outcome: "succeeded",
    metadata: { action: "auth.change_password", other_sessions_revoked: true },
  });
  await recordSecurityAuditEvent({
    event: "auth.password.changed",
    correlationId,
    actorId: context.actor.id,
    actorClass: "self_service",
    actionSlug: "auth.change_password",
    outcome: "succeeded",
    /* Not `other_sessions_revoked`: that key carries the "session" fragment
     * and would be stripped from permanent rows by design. */
    metadata: { action: "auth.change_password", other_logins_revoked: true },
  });

  return { error: null, fieldErrors: {}, changedAt: new Date().toISOString() };
}

