"use server";

import { randomUUID } from "node:crypto";
import { hashActivationToken } from "../../lib/email/client-welcome-email-server";
import { readServerEnvironment } from "../../lib/env/server-env";
import { AuthAdminAdapter, AuthAdminError } from "../../lib/supabase/auth-admin";
import { requestTenantSelector } from "../../lib/supabase/next-server";
import { createTrustedServerSupabaseClient } from "../../lib/supabase/trusted-server-client";

export type ActivateAccountState = { error: string | null; done: boolean };

const INVALID_LINK =
  "This link is invalid, already used or expired. If you already set a password, sign in. Otherwise, reply to your welcome email for help.";
const UNCONFIRMED =
  "We couldn't confirm your password setup. Try signing in with the password you chose. If you can't sign in, reply to your welcome email for help.";

/**
 * Sets a new client's first password from their welcome email link (KI-091).
 *
 * The link token arrives in the POST body only (the page reads it from the
 * URL fragment), so a link scanner's GET can never spend it. Reserve the
 * link before touching Auth so only one password write can use it.
 */
export async function activateAccountAction(
  _state: ActivateAccountState,
  formData: FormData,
): Promise<ActivateAccountState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (!/^[\w-]{43}$/u.test(token)) return { error: INVALID_LINK, done: false };
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return { error: "Use at least 8 characters and at most 72 UTF-8 bytes.", done: false };
  }
  if (password !== confirmPassword) return { error: "The passwords do not match.", done: false };

  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const tenantId = await requestTenantSelector();
  const claimId = randomUUID();
  let profileId: string | null;
  try {
    const { data, error } = await trusted.rpc("app_server_claim_client_activation", {
      p_claim_id: claimId,
      p_tenant_id: tenantId,
      p_token_hash: hashActivationToken(token),
    });
    if (error) return { error: UNCONFIRMED, done: false };
    profileId = data;
  } catch {
    return { error: UNCONFIRMED, done: false };
  }
  if (!profileId) return { error: INVALID_LINK, done: false };

  const activation = { p_claim_id: claimId, p_profile_id: profileId, p_tenant_id: tenantId };
  const finish = async (result: "activated" | "weak_password") => {
    try {
      const { data, error } = await trusted.rpc("app_server_finish_client_activation", {
        ...activation,
        p_result: result,
      });
      return !error && data === true;
    } catch {
      return false;
    }
  };

  try {
    await AuthAdminAdapter.create().setPassword(profileId, password);
  } catch (caught) {
    if (caught instanceof AuthAdminError && caught.failure.reason === "weak_password" && await finish("weak_password")) {
      return { error: "That password is too weak. Choose something longer or less common.", done: false };
    }
    return { error: UNCONFIRMED, done: false };
  }

  if (!await finish("activated")) return { error: UNCONFIRMED, done: false };
  return { error: null, done: true };
}
