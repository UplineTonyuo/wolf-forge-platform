"use server";

import { hashActivationToken } from "../../lib/email/client-welcome-email-server";
import { readServerEnvironment } from "../../lib/env/server-env";
import { AuthAdminAdapter, AuthAdminError } from "../../lib/supabase/auth-admin";
import { requestTenantSelector } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";

export type ActivateAccountState = { error: string | null; done: boolean };

const INVALID_LINK =
  "This link is invalid, already used or expired. Reply to your welcome email and Wolf Forge will send a new one.";

/**
 * Sets a new client's first password from their welcome email link (KI-091).
 *
 * The link token arrives in the POST body only (the page reads it from the
 * URL fragment), so a link scanner's GET can never spend it. The token is
 * looked up by its SHA-256 and spent only after the password is saved, so a
 * rejected password can be retried with the same link.
 */
export async function activateAccountAction(
  _state: ActivateAccountState,
  formData: FormData,
): Promise<ActivateAccountState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!/^[\w-]{43}$/u.test(token)) return { error: INVALID_LINK, done: false };
  if (password.length < 8 || password.length > 72) {
    return { error: "Use 8 to 72 characters.", done: false };
  }
  if (password !== confirmPassword) return { error: "The passwords do not match.", done: false };

  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const tokenHash = hashActivationToken(token);
  // The link only spends on the Tenant whose verified host the request came in on.
  const { data: profileId, error } = await trusted.rpc("app_server_find_client_activation", {
    p_token_hash: tokenHash,
    p_tenant_id: await requestTenantSelector(),
  });
  if (error || !profileId) return { error: INVALID_LINK, done: false };

  try {
    await AuthAdminAdapter.create().setPassword(profileId, password);
  } catch (caught) {
    return {
      error: caught instanceof AuthAdminError && caught.failure.reason === "weak_password"
        ? "That password is too weak. Choose something longer or less common."
        : "Your password could not be saved. Try again.",
      done: false,
    };
  }

  await trusted.rpc("app_server_complete_client_activation", {
    p_profile_id: profileId,
    p_token_hash: tokenHash,
  });

  return { error: null, done: true };
}
