import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { SubscriptionsList } from "../../../components/subscriptions/subscriptions-list";
import { SubscriptionHistoryBoundary } from "../../../components/subscriptions/subscription-history-boundary";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";
import { toClientSafeError } from "../../../lib/errors/application-error";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const context = await getInternalContext();
  const [summaries, workEnabled] = await Promise.all([
    context.services.subscriptions.list(), context.services.subscriptions.workEnabled(),
  ]).catch((error: unknown) => {
    if (toClientSafeError(error).code === "PERMISSION_DENIED") forbidden();
    throw error;
  });

  return (
    <SubscriptionHistoryBoundary key={`${workEnabled}:${summaries.map((row) => `${row.subscription_id}:${row.status}`).join(",")}`} states={summaries.map((row) => `${row.subscription_id}:${row.status}`)} workEnabled={workEnabled} ids={summaries.map((row) => row.subscription_id)} audience="internal"><PageFrame
      title="Subscriptions"
      description={workEnabled ? "Manage recurring client billing and service plans." : "Subscriptions are disabled. Authorized canceled history remains available."}
    >
      <SubscriptionsList summaries={summaries} canManage={context.user.subscriptions.manage && workEnabled} initialStatus={workEnabled ? "active" : "canceled"} />
    </PageFrame></SubscriptionHistoryBoundary>
  );
}
