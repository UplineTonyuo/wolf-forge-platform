import type { Metadata } from "next";
import { SubscriptionPlanForm } from "../../../../components/subscriptions/subscription-plan-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Subscription" };

export default async function NewSubscriptionPage() {
  const context = await getInternalContext();
  const [companies, services, folders] = await Promise.all([
    context.services.companies.listActive(),
    context.services.catalog.listCatalog(),
    context.services.catalog.listFolders(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return <PageFrame title="New Subscription" description="Create an administrative recurring plan using a snapshot of current Service terms." narrow><SubscriptionPlanForm mode="create" companies={companies.map((company) => ({ id: company.id, name: company.name, recordKind: "client" as const }))} services={services} folders={folders} today={today} requestId={crypto.randomUUID()} /></PageFrame>;
}
