import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionStatus } from "../../../../components/settings/connection-status";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Billing & Payments Settings" };

export default async function BillingSettingsPage() {
  const { services } = await getInternalContext();
  const connections = await services.integrations.listConnections().catch(() => null);
  const paymentConnections = connections?.filter(({ provider }) => provider.id === "stripe" || provider.id === "paypal") ?? null;

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Billing &amp; Payments</h2>
        <p>Payment-provider readiness without changing Invoice, Store, Subscription, Wallet, or ledger behavior.</p>
      </header>

      {!paymentConnections ? <DataError message="Payment-provider state could not be loaded." /> : (
        <div className={styles.sectionStack}>
          <section className={styles.surfaceSection}>
            <div className={styles.sectionHeading}>
              <span className={styles.eyebrow}>Provider connections</span>
              <h2>Payment processors</h2>
              <p>Canonical connection management remains in Integrations.</p>
            </div>
            <div>
              <ul className={styles.foundationList}>
                {paymentConnections.map((connection) => (
                  <li key={connection.provider.id}>
                    <strong>{connection.provider.name}</strong>
                    <ConnectionStatus status={connection.status} />
                  </li>
                ))}
              </ul>
              <Link href="/settings/integrations" className={styles.textLink}>Manage integrations</Link>
            </div>
          </section>
          <section className={styles.surfaceSection}>
            <div className={styles.sectionHeading}>
              <span className={styles.eyebrow}>Separate concern</span>
              <h2>Feature enablement</h2>
              <p>A provider connection does not automatically enable payment behavior.</p>
            </div>
            <div className={styles.callout}>
              Store payments, Invoice payments, and Subscription autopay remain unchanged. Their future enablement will be persisted separately from connection status.
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
