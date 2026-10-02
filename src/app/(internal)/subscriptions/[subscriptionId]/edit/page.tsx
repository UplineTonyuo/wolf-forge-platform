import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SubscriptionPlanForm } from "../../../../../components/subscriptions/subscription-plan-form";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Subscription Plan" };

export default async function EditSubscriptionPlanPage({ params }: { params: Promise<{ subscriptionId: string }> }) {
  const [{ subscriptionId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const [detail, services, folders] = await Promise.all([context.services.subscriptions.get(subscriptionId), context.services.catalog.listCatalog(), context.services.catalog.listFolders()]);
    // Eligible Services plus whatever this subscription already carries, which stays valid.
    const carriedServiceIds = new Set([detail.subscription.service_id, ...detail.plan_items.map((item) => item.service_id)]);
    const pickerServices = services.filter((service) => service.subscription_eligible || carriedServiceIds.has(service.id));
    const today = new Date().toISOString().slice(0, 10);
    return <PageFrame title="Edit Subscription Plan" description="Create a new commercial terms version without rewriting prior Invoices." narrow><SubscriptionPlanForm mode="edit" companies={[]} services={pickerServices} folders={folders} today={today} requestId={crypto.randomUUID()} subscriptionId={subscriptionId} detail={detail} /></PageFrame>;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
