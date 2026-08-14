import type { Metadata } from "next";
import { ClientSubscriptionsList } from "../../../components/subscriptions/client-subscriptions";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Subscriptions" };

export default async function ClientSubscriptionsPage() {
  const context = await getClientContext();
  const summaries = await context.services.subscriptions.list();
  return <ClientSubscriptionsList summaries={summaries} />;
}
