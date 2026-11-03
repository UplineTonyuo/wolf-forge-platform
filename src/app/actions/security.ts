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
import { clientSupportRequested } from "../../lib/supabase/client-support";
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
 * Server-verified self-service context selects the actor. The cookie-bound Auth
 * client receives the current and new passwords in one updateUser request;
 * current-password enforcement depends on the Auth provider's configuration.
 * No throwaway sign-in or administrator API is used.
 *
 * After a successful update, request sign-out of other sessions and report its
 * confirmed result separately. An unconfirmed sign-out does not undo the
 * password change or invite resubmission.
 *
 * No password value is logged, retained or returned at any point.
 */
export async function changeMyPasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  void _state;
  if (await clientSupportRequested()) return fail("Exit client support before changing account settings.");

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
   * Supply both passwords to the authenticated self-service Auth request.
   * No temporary sign-in session is created.
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

  let otherSessionsRevoked = false;
  try {
    const { error: revocationError } = await supabase.auth.signOut({ scope: "others" });
    otherSessionsRevoked = !revocationError;
  } catch {
    // The password already changed; an uncertain sign-out must not invite another update.
  }

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
    metadata: { action: "auth.change_password", other_sessions_revoked: otherSessionsRevoked },
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
    metadata: { action: "auth.change_password", other_logins_revoked: otherSessionsRevoked },
  });

  return {
    error: null,
    fieldErrors: {},
    changedAt: new Date().toISOString(),
    ...(!otherSessionsRevoked ? {
      warning: "Your password was changed, but signing out other devices could not be confirmed. Sign out of those devices manually.",
    } : {}),
  };
}

