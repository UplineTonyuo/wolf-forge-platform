import type { Metadata } from "next";
import { SettingsWorkspace } from "../../../../components/settings/settings-workspace";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "General Settings" };

export default async function GeneralSettingsPage() {
  const context = await getInternalContext();
  const profile = await context.services.profile.getMine().catch(() => null);

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>General</h2>
        <p>Your member identity and the platform defaults Wolf Forge currently uses.</p>
      </header>

      {profile ? (
        <SettingsWorkspace profile={profile} identities={[]} showPreferences={false} showSecurity={false} />
      ) : (
        <DataError message="Your profile could not be loaded." />
      )}

      <section className={styles.surfaceSection}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>Platform defaults</span>
          <h2>Business configuration</h2>
          <p>No separate business-settings aggregate exists in the current domain, so these values remain honest read-only foundations.</p>
        </div>
        <dl className={styles.readOnlyGrid}>
          <div><dt>Business display</dt><dd>Wolf Forge platform identity; your member display name is managed above.</dd></div>
          <div><dt>Branding</dt><dd>Wolf Forge product mark and current shell branding.</dd></div>
          <div><dt>Business timezone</dt><dd>Asia/Manila, the established reporting business timezone.</dd></div>
          <div><dt>Default currency</dt><dd>No platform-wide default. Invoices, subscriptions, wallets, and services retain their own persisted currencies.</dd></div>
        </dl>
      </section>
    </div>
  );
}
