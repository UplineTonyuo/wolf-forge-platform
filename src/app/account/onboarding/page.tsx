import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientOnboardingView } from "../../../components/account/onboarding/client-onboarding";
import { composeClientOnboarding } from "../../../domain/client-portal/onboarding";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientAssignments } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Onboarding" };

export default async function ClientOnboardingPage() {
  const { services } = await getClientContext();

  let denied = false;
  let loadError: string | null = null;
  let assignments = null;

  try {
    /*
     * The module boundary is the authority, not the rail. A typed URL reaches
     * this call and is rejected exactly like a hidden nav item. Which
     * assignments exist is decided separately by app_list_assigned_forms, which
     * derives the account from auth.uid().
     */
    await services.permissions.requireModuleAccess("portal_forms");
    assignments = await readClientAssignments();
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Onboarding could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Onboarding</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  return <ClientOnboardingView onboarding={composeClientOnboarding(assignments ?? [])} />;
}
