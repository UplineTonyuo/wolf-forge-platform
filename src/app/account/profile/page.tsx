import type { Metadata } from "next";
import { ClientProfile } from "../../../components/account/profile/client-profile";
import type { SignInIdentity } from "../../../domain/profile/security";
import {
  createNextServerSupabaseClient,
  getClientContext,
} from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Profile" };

/**
 * The account's real sign-in identities, from Supabase Auth.
 *
 * getUserIdentities() resolves against the caller's own session, so there is no
 * user id to pass and none is accepted. Only what Auth actually returns is
 * rendered — no speculative provider list.
 */
async function loadSignInIdentities(): Promise<SignInIdentity[]> {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getUserIdentities();

  if (error || !data?.identities) return [];

  return data.identities.map((identity) => ({
    id: identity.identity_id ?? identity.id,
    provider: identity.provider,
    email:
      typeof identity.identity_data?.email === "string" ? identity.identity_data.email : null,
    /* The password credential is the account's primary and cannot be removed. */
    isPrimary: identity.provider === "email",
  }));
}

export default async function ClientProfilePage() {
  const context = await getClientContext();

  /*
   * No module gate. Profile is self-service: app_get_my_profile is granted to
   * `authenticated` and derives the account from auth.uid(), so every signed-in
   * account can reach its own profile and no account can reach another's. There
   * is no identifier on this page to get wrong.
   */
  const [profile, identities] = await Promise.all([
    context.services.profile.getMine().catch(() => null),
    loadSignInIdentities().catch(() => []),
  ]);

  if (!profile) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <span className="portal-eyebrow">Account</span>
          <h1>Profile</h1>
        </header>
        <p className="portal-empty">Your profile could not be loaded.</p>
      </div>
    );
  }

  return (
    <ClientProfile
      profile={profile}
      companyName={context.user.companyName}
      identities={identities}
    />
  );
}
