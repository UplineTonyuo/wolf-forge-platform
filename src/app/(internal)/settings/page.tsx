import type { Metadata } from "next";
import { SettingsWorkspace } from "../../../components/settings/settings-workspace";
import { DataError } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import type { SignInIdentity } from "../../../domain/profile/security";
import {
  createNextServerSupabaseClient,
  getInternalContext,
} from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Settings" };

/**
 * Reads the account's real sign-in identities from Supabase Auth.
 *
 * getUserIdentities() resolves against the caller's own session, so there is no
 * user id to pass and none is accepted. Only what Auth returns is rendered.
 */
async function loadSignInIdentities(): Promise<SignInIdentity[]> {
  const supabase = await createNextServerSupabaseClient();
  const { data, error } = await supabase.auth.getUserIdentities();

  if (error || !data?.identities) return [];

  return data.identities.map((identity) => ({
    id: identity.identity_id ?? identity.id,
    provider: identity.provider,
    email:
      typeof identity.identity_data?.email === "string"
        ? identity.identity_data.email
        : null,
    /* The password credential is the account's primary and cannot be removed. */
    isPrimary: identity.provider === "email",
  }));
}

export default async function SettingsPage() {
  const context = await getInternalContext();

  /*
   * app_get_my_profile derives the account from auth.uid(), so this page has no
   * identifier to get wrong and cannot be pointed at another profile.
   */
  const [profile, identities] = await Promise.all([
    context.services.profile.getMine().catch(() => null),
    loadSignInIdentities().catch(() => []),
  ]);

  /*
    The wrapper opts this route into the centered Settings reading column
    defined in globals.css; every other internal page keeps the full-bleed
    operational width.
  */
  return (
    <div className="settings-page-layout">
      <PageFrame
        title="Settings"
        description="Your Wolf Forge account, profile and personal preferences."
      >
        {profile ? (
          <SettingsWorkspace profile={profile} identities={identities} />
        ) : (
          <DataError message="Your profile could not be loaded." />
        )}
      </PageFrame>
    </div>
  );
}
