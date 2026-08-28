import type { Metadata } from "next";
import { IntegrationProviderCard } from "../../../../components/settings/integration-provider-card";
import styles from "../../../../components/settings/settings-foundation.module.css";
import { DataError } from "../../../../components/ui/list-states";
import { isGmailIntegrationConfigured } from "../../../../lib/integrations/gmail-server";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Integrations Settings" };

const GMAIL_RESULTS: Record<string, { tone: "success" | "error"; message: string }> = {
  connected: { tone: "success", message: "Gmail connected. Encrypted credentials and safe account metadata were saved." },
  verified: { tone: "success", message: "Gmail connection verified successfully." },
  disconnected: { tone: "success", message: "Gmail disconnected and its stored credential was destroyed." },
  "state-error": { tone: "error", message: "Gmail connection was rejected because the authorization state was missing or invalid. Start again from this page." },
  "provider-error": { tone: "error", message: "Google did not authorize the connection. No Gmail connection was created." },
  "callback-error": { tone: "error", message: "Google returned an incomplete authorization response. Start the connection again." },
  "connection-error": { tone: "error", message: "Gmail could not be connected. No Connected state was created; verify configuration and try again." },
  reauthorize: { tone: "error", message: "Google no longer accepts the saved authorization. Reconnect Gmail to continue." },
  "verify-error": { tone: "error", message: "Gmail could not be verified right now. No credentials were exposed." },
  "disconnect-error": { tone: "error", message: "Gmail could not be disconnected. Try again before relying on the connection state." },
};

export default async function IntegrationsSettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const { services, user } = await getInternalContext();
  const [connections, query] = await Promise.all([services.integrations.listConnections().catch(() => null), searchParams]);
  const gmailResult = query.gmail ? GMAIL_RESULTS[query.gmail] : undefined;
  const gmailConfigured = isGmailIntegrationConfigured();

  return (
    <div>
      <header className={styles.pageIntro}>
        <h2>Integrations</h2>
        <p>External provider connections with explicit state, server-authorized administration, and no browser-visible credentials.</p>
      </header>

      {gmailResult ? <div className={gmailResult.tone === "success" ? styles.successNotice : styles.errorNotice} role={gmailResult.tone === "error" ? "alert" : "status"}>{gmailResult.message}</div> : null}

      <div className={styles.callout}>
        <strong>Server-controlled connections</strong>
        Gmail authorization runs on the server once configured. Stripe and PayPal remain foundation-only and cannot manufacture Connected state.
      </div>

      {connections ? (
        <div className={styles.providerList}>
          {connections.map((connection) => (
            <IntegrationProviderCard
              key={connection.provider.id}
              connection={connection}
              canManage={user.integrations.manage}
              actions={connection.provider.id === "gmail" ? {
                configured: gmailConfigured,
                connectPath: "/settings/integrations/gmail/connect",
                verifyPath: "/settings/integrations/gmail/verify",
                disconnectPath: "/settings/integrations/gmail/disconnect",
              } : undefined}
            />
          ))}
        </div>
      ) : (
        <DataError message="Integration connection state could not be loaded." />
      )}
    </div>
  );
}
