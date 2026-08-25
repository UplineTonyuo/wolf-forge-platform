import "server-only";

import type { SignInIdentity } from "../../domain/profile/security";
import { createNextServerSupabaseClient } from "../supabase/next-server";

/** Reads only the current caller's real identities from Supabase Auth. */
export async function loadSignInIdentities(): Promise<SignInIdentity[]> {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data?.identities) return [];

  return data.identities.map((identity) => ({
    id: identity.identity_id ?? identity.id,
    provider: identity.provider,
    email: typeof identity.identity_data?.email === "string" ? identity.identity_data.email : null,
    isPrimary: identity.provider === "email",
  }));
}
