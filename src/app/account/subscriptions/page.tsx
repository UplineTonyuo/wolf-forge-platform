import type { Metadata } from "next";
import { SubscriptionHistoryBoundary } from "../../../components/subscriptions/subscription-history-boundary";
import { redirect } from "next/navigation";
import { ClientSubscriptionsList } from "../../../components/subscriptions/client-subscriptions";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function ClientSubscriptionsPage() {
  const { services } = await getClientContext();

  let denied = false;
  let loadError: string | null = null;
  let summaries = null;

  try {
    summaries = await services.subscriptions.list();
    await services.subscriptions.workEnabled();
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

  return <SubscriptionHistoryBoundary key={(summaries ?? []).map((row) => `${row.subscription_id}:${row.status}`).join(",")} states={(summaries ?? []).map((row) => `${row.subscription_id}:${row.status}`)} ids={(summaries ?? []).map((row) => row.subscription_id)} audience="client"><ClientSubscriptionsList summaries={summaries ?? []} /></SubscriptionHistoryBoundary>;
}
