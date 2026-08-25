"use client";

import { ChevronDown, ChevronUp, LockKeyhole } from "lucide-react";
import { useId, useState } from "react";
import type { IntegrationConnectionView } from "../../domain/integrations/schema";
import { ConnectionStatus } from "./connection-status";
import { ProviderIcon } from "./provider-icon";
import styles from "./settings-foundation.module.css";

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type DisconnectAction = (formData: FormData) => void | Promise<void>;

export function IntegrationManagePanel({
  connection,
  disconnectAction,
}: {
  connection: IntegrationConnectionView;
  disconnectAction?: DisconnectAction;
}) {
  const connectedAt = formatTimestamp(connection.connectedAt);

  return (
    <div className={styles.managePanel}>
      {connection.status === "disconnected" ? (
        <>
          <div className={styles.secureNote}>
            <LockKeyhole aria-hidden="true" />
            <div>
              <strong>Secure configuration foundation</strong>
              <p>{connection.provider.configurationSummary}</p>
            </div>
          </div>
          <p className={styles.manageCopy}>
            This step does not create a connection record or store credentials. A future
            provider-specific setup will complete authorization on the server before the
            status can change.
          </p>
        </>
      ) : (
        <dl className={styles.connectionDetails}>
          <div>
            <dt>Account</dt>
            <dd>{connection.connectedAccountDisplay ?? "Identity not provided"}</dd>
          </div>
          <div>
            <dt>Connected</dt>
            <dd>{connectedAt ?? "Timestamp unavailable"}</dd>
          </div>
          <div>
            <dt>Feature enablement</dt>
            <dd>Managed separately when provider payment or communication flows are implemented.</dd>
          </div>
        </dl>
      )}
      {connection.status === "connected" && disconnectAction ? (
        <form action={disconnectAction} className={styles.disconnectForm}>
          <input type="hidden" name="provider" value={connection.provider.id} />
          <button type="submit" className={styles.dangerButton}>Disconnect</button>
        </form>
      ) : null}
    </div>
  );
}

export function IntegrationProviderCard({
  connection,
  canManage,
  disconnectAction,
}: {
  connection: IntegrationConnectionView;
  canManage: boolean;
  disconnectAction?: DisconnectAction;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const actionLabel = connection.status === "connected"
    ? "Manage"
    : connection.status === "error" || connection.status === "expired"
      ? "Reconnect"
      : "Connect";

  return (
    <article className={styles.providerCard} id={connection.provider.id}>
      <div className={styles.providerMain}>
        <ProviderIcon provider={connection.provider.iconKey} />
        <div className={styles.providerCopy}>
          <div className={styles.providerTitleRow}>
            <h3>{connection.provider.name}</h3>
            <ConnectionStatus status={connection.status} />
          </div>
          <p>{connection.provider.description}</p>
          {connection.connectedAccountDisplay ? (
            <span className={styles.connectedIdentity}>{connection.connectedAccountDisplay}</span>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            className={styles.providerAction}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((current) => !current)}
          >
            {actionLabel}
            {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
        ) : (
          <span className={styles.permissionNote}>View only</span>
        )}
      </div>

      {expanded ? (
        <div id={panelId} className={styles.providerPanel} role="region" aria-label={`${connection.provider.name} configuration`}>
          <IntegrationManagePanel connection={connection} disconnectAction={disconnectAction} />
        </div>
      ) : null}
    </article>
  );
}
