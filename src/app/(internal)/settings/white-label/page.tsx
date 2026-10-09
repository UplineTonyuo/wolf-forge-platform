import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { WhiteLabelBuilder } from "../../../../components/white-label/white-label-builder";
import { localUiQaBypassEnabled } from "../../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "White Label" };

/*
 * WL-2.31 / WL-2.32: a local QA-only, unsaved preview on synthetic
 * configuration. It reads and writes no Tenant data. The route exists only
 * inside the local QA gate AND for a session whose identity holds the global
 * Platform Admin entitlement (app_is_platform_admin, never a Tenant role).
 * It stays local-only until real White Label management and its deployment
 * conditions are approved.
 */
export default async function WhiteLabelSettingsPage() {
  if (!(await localUiQaBypassEnabled())) notFound();

  // Layout and page render concurrently; keep the same Settings boundary here.
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");
  if (!(await context.services.permissions.isPlatformAdmin())) notFound();

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>White Label</h2>
        <p>Preview how a workspace looks with its own name, colors and modules.</p>
      </header>
      <WhiteLabelBuilder />
    </div>
  );
}
