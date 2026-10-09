import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { WhiteLabelDraftEditor } from "../../../../components/white-label/white-label-draft-editor";
import { isLocalQuickAccessSession, localUiQaBypassEnabled } from "../../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "White Label" };

/*
 * WL-2.31 / WL-2.32 / WL-2.33: Platform Admin White Label DRAFTS. The route
 * exists only inside the local QA gate, for a real (never Quick Access)
 * session whose identity holds the global Platform Admin entitlement
 * (app_is_platform_admin, never a Tenant role). `?tenant=` only names the
 * draft to open; the RPCs re-check the entitlement and the Tenant. Saving a
 * draft publishes nothing. It stays local-only until publication and its
 * deployment conditions are approved.
 */
export default async function WhiteLabelSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  if (!(await localUiQaBypassEnabled())) notFound();

  // Layout and page render concurrently; keep the same Settings boundary here.
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");
  if (await isLocalQuickAccessSession(context.actor)) notFound();
  if (!(await context.services.permissions.isPlatformAdmin())) notFound();

  const tenants = await context.services.whiteLabel.listTenants();
  const { tenant } = await searchParams;
  const initialDraft =
    typeof tenant === "string" && tenants.some((entry) => entry.id === tenant)
      ? await context.services.whiteLabel.getDraft(tenant)
      : null;

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>White Label</h2>
        <p>Prepare a Tenant&apos;s workspace name, colors and modules as a draft.</p>
      </header>
      <WhiteLabelDraftEditor tenants={tenants} initialDraft={initialDraft} />
    </div>
  );
}
