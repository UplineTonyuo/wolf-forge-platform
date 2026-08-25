import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Team & Access Settings" };

export default async function TeamAccessSettingsPage() {
  const { services, user } = await getInternalContext();
  const result = await Promise.all([
    services.permissions.listInternalMembers(),
    services.permissions.listPresetOverview(),
  ]).then(([members, presets]) => ({ members, presets })).catch(() => null);

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Team &amp; Access</h2>
        <p>Existing members, persisted role presets, and the same capability model used throughout Wolf Forge.</p>
      </header>

      {!result ? <DataError message="Team access could not be loaded." /> : (
        <div className={styles.sectionStack}>
          <div className={styles.teamSummary}>
            <div className={styles.teamMetric}><span>Internal members</span><strong>{result.members.length}</strong></div>
            <div className={styles.teamMetric}><span>Role presets</span><strong>{result.presets.filter((preset) => preset.account_class === "internal").length}</strong></div>
            <div className={styles.teamMetric}><span>Your access</span><strong>{user.team.managePermissions ? "Admin" : "View"}</strong></div>
          </div>
          <section className={styles.surfaceSection}>
            <div className={styles.sectionHeading}>
              <span className={styles.eyebrow}>Canonical authorization</span>
              <h2>Roles and capabilities</h2>
              <p>Settings does not create a second role system. Provisioning and grants remain in Team.</p>
            </div>
            <div>
              <ul className={styles.foundationList}>
                {result.presets.filter((preset) => preset.account_class === "internal").map((preset) => (
                  <li key={preset.preset_key}>
                    <strong>{preset.preset_name}</strong>
                    <span>{preset.member_count} {preset.member_count === 1 ? "member" : "members"}</span>
                  </li>
                ))}
              </ul>
              <Link className={styles.textLink} href="/team">Open Team &amp; Roles</Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
