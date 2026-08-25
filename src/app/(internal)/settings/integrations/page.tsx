import type { Metadata } from "next";
import { IntegrationProviderCard } from "../../../../components/settings/integration-provider-card";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Integrations Settings" };

export default async function IntegrationsSettingsPage() {
  const { services, user } = await getInternalContext();
  const connections = await services.integrations.listConnections().catch(() => null);

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Integrations</h2>
        <p>External provider connections with explicit state, server-authorized administration, and no browser-visible credentials.</p>
      </header>

      <div className={styles.callout}>
        <strong>Connection foundation</strong>
        Connect opens an honest setup explanation. It cannot mark a provider connected; only persisted metadata written after a future server-side provider authorization can do that.
      </div>

      {connections ? (
        <div className={styles.providerList}>
          {connections.map((connection) => (
            <IntegrationProviderCard key={connection.provider.id} connection={connection} canManage={user.integrations.manage} />
          ))}
        </div>
      ) : (
        <DataError message="Integration connection state could not be loaded." />
      )}
    </div>
  );
}
