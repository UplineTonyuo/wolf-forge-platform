import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLocalQuickAccessSession } from "../../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "White Label" };

// Legacy bookmarks retain their original authorization boundary before redirecting.
export default async function WhiteLabelSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {

  // Layout and page render concurrently; keep the same Settings boundary here.
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");
  if (await isLocalQuickAccessSession(context.actor)) notFound();
  if (!(await context.services.permissions.isPlatformAdmin())) notFound();

  const tenants = await context.services.whiteLabel.listTenants();
  const { tenant } = await searchParams;
  const query = typeof tenant === "string" && tenants.some((entry) => entry.id === tenant)
    ? `?tenant=${encodeURIComponent(tenant)}` : "";
  redirect(`/white-label${query}`);
}
