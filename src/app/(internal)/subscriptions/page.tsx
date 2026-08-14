import type { Metadata } from "next";
import { SubscriptionsList } from "../../../components/subscriptions/subscriptions-list";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const context = await getInternalContext();
  const summaries = await context.services.subscriptions.list();

  return (
    <PageFrame
      title="Subscriptions"
      description="Manage recurring client billing and service plans."
    >
      <SubscriptionsList summaries={summaries} canManage={context.user.subscriptions.manage} />
    </PageFrame>
  );
}
