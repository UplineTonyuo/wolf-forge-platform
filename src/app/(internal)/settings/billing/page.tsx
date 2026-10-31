import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { ConnectionStatus } from "../../../../components/settings/connection-status";
import { InvoiceManualPaymentSettings } from "../../../../components/invoices/invoice-manual-payment";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Billing & Payments Settings" };

export default async function BillingSettingsPage() {
  const { services, user } = await getInternalContext();
  const manual = user.invoices.manage ? await services.invoices.getManualPaymentSettings().catch(() => null) : null;
  const connections = await services.integrations.listConnections().catch(() => null);
  const paymentConnections = connections?.filter(({ provider }) => provider.id === "stripe" || provider.id === "paypal") ?? null;

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Billing &amp; Payments</h2>
        <p>Manage invoice payment instructions and view payment-provider readiness.</p>
      </header>
      {manual ? <InvoiceManualPaymentSettings initial={manual} /> : user.invoices.manage ? <DataError message="Manual payment settings could not be loaded." /> : null}

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
              <p>A provider connection does not enable automatic charges. Manual invoice receipts require your team&apos;s verification; these settings do not enable Store payments or Subscription autopay.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
