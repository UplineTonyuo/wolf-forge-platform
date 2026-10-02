import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
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
          <section className={styles.panel} aria-labelledby="payment-processors-heading">
            <div className={styles.panelHeading}>
              <h3 id="payment-processors-heading">Payment processors</h3>
              <p>Read-only connection state. Canonical connection management remains in Integrations.</p>
            </div>

            <ul className={styles.rowList}>
              {paymentConnections.map((connection) => (
                <li key={connection.provider.id} className={styles.row}>
                  <span className={styles.rowLabel}>{connection.provider.name}</span>
                  <ConnectionStatus status={connection.status} />
                </li>
              ))}
            </ul>

            <div className={styles.panelFooter}>
              <Link href="/settings/integrations" className={styles.textLink}>Manage integrations</Link>
            </div>
          </section>

          <div className={styles.callout}>
            <Info aria-hidden="true" />
            <div>
              <strong>Feature enablement</strong>
              <p>A provider connection does not automatically enable payment behavior. Store payments, Invoice payments, and Subscription autopay remain unchanged; their future enablement will be persisted separately from connection status.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
