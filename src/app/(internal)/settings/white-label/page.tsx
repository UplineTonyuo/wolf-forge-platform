import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { WhiteLabelBuilder } from "../../../../components/white-label/white-label-builder";
import { localUiQaBypassEnabled } from "../../../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "White Label" };

/*
 * WL-2.31: no Platform Admin control plane exists yet, so this is a local
 * QA-only, unsaved preview on synthetic configuration. It reads and writes no
 * Tenant data. Outside the local QA gate the route does not exist.
 */
export default async function WhiteLabelSettingsPage() {
  if (!(await localUiQaBypassEnabled())) notFound();

  // Layout and page render concurrently; keep the same Settings boundary here.
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");

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
