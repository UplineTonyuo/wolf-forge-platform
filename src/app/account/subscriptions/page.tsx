import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientSubscriptionsList } from "../../../components/subscriptions/client-subscriptions";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientSubscriptions } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function ClientSubscriptionsPage() {
  const { services } = await getClientContext();

  let denied = false;
  let loadError: string | null = null;
  let summaries = null;

  try {
    await services.permissions.requireModuleAccess("portal_subscriptions");
    summaries = await readClientSubscriptions();
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Subscriptions could not be loaded.";
  }

  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Subscriptions</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  return <ClientSubscriptionsList summaries={summaries ?? []} />;
}
