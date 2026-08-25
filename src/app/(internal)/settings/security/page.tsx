import type { Metadata } from "next";
import { SecuritySettingsPanel } from "../../../../components/settings/security-settings-panel";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { loadSignInIdentities } from "../../../../lib/settings/sign-in-identities";

export const metadata: Metadata = { title: "Security Settings" };

export default async function SecuritySettingsPage() {
  const identities = await loadSignInIdentities().catch(() => []);

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Security</h2>
        <p>Your current account password and the sign-in identities Supabase Auth actually reports. No speculative session or connected-app control is shown.</p>
      </header>
      <SecuritySettingsPanel identities={identities} />
    </div>
  );
}
