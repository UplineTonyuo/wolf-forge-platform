import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WhiteLabelDraftEditor } from "../../../components/white-label/white-label-draft-editor";
import { isLocalQuickAccessSession } from "../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "White Label Studio" };

export default async function WhiteLabelStudioPage({ searchParams }: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  const context = await getInternalContext();
  if (await isLocalQuickAccessSession(context.actor)) notFound();
  if (!(await context.services.permissions.isPlatformAdmin())) notFound();
  await context.services.permissions.requireModuleAccess("settings");
  const tenants = await context.services.whiteLabel.listTenants();
  const { tenant } = await searchParams;
  const initialDraft = typeof tenant === "string" && tenants.some((entry) => entry.id === tenant)
    ? await context.services.whiteLabel.getDraft(tenant) : null;
  return <WhiteLabelDraftEditor tenants={tenants} initialDraft={initialDraft} />;
}
