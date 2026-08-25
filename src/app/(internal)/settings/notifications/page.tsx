import type { Metadata } from "next";
import { NotificationSettingsPanel } from "../../../../components/settings/notification-settings-panel";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Notification Settings" };

export default async function NotificationSettingsPage() {
  const { services } = await getInternalContext();
  const profile = await services.profile.getMine().catch(() => null);

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Notifications</h2>
        <p>Real personal preferences today, with clearly labeled foundations for future delivery controls.</p>
      </header>
      {profile ? <NotificationSettingsPanel soundEnabled={profile.notificationSoundEnabled} /> : <DataError message="Notification preferences could not be loaded." />}
    </div>
  );
}
