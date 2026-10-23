import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { SubscriptionPlanForm } from "../../../../components/subscriptions/subscription-plan-form";
import { SubscriptionHistoryBoundary } from "../../../../components/subscriptions/subscription-history-boundary";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Subscription" };

export default async function NewSubscriptionPage() {
  const context = await getInternalContext();
  if (!context.user.subscriptions.manage || !await context.services.subscriptions.workEnabled()) forbidden();
  const [companies, services, folders] = await Promise.all([
    context.services.companies.listActive(),
    context.services.catalog.listCatalog(),
    context.services.catalog.listFolders(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return <SubscriptionHistoryBoundary ids={[]} workEnabled audience="internal"><PageFrame title="New Subscription" description="Create an administrative recurring plan using a snapshot of current Service terms." narrow><SubscriptionPlanForm mode="create" companies={companies.map((company) => ({ id: company.id, name: company.name, recordKind: "client" as const }))} services={services.filter((service) => service.subscription_eligible)} folders={folders} today={today} requestId={crypto.randomUUID()} /></PageFrame></SubscriptionHistoryBoundary>;
}
