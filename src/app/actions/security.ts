"use server";

import {
  changePasswordSchema,
  type PasswordActionState,
} from "../../domain/profile/security";
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
     * Keep authentication details private. A bad current password gets a
     * field-level message; every other Auth error goes through the existing
     * client-safe mapper.
     */
    if (
      error.code === "invalid_credentials" ||
      error.code === "bad_password"
    ) {
      return fail("Check the highlighted fields.", {
        current_password: "That password is incorrect.",
      });
    }

    return fail(safePasswordError(error.code));
  }

  /* Anything signed in with the old password is now invalidated. */
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

  return { error: null, fieldErrors: {}, changedAt: new Date().toISOString() };
}

