"use client";

import { ChevronDown, ChevronUp, LockKeyhole, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
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

export type IntegrationProviderActions = {
  configured: boolean;
  connectPath: string;
  verifyPath: string;
  disconnectPath: string;
};

export function IntegrationManagePanel({
  connection,
  actions,
  pendingAction,
  locked = false,
  onSubmit,
}: {
  connection: IntegrationConnectionView;
  actions?: IntegrationProviderActions;
  pendingAction: string | null;
  locked?: boolean;
  onSubmit: (action: string, event: FormEvent<HTMLFormElement>) => void;
}) {
  const connectedAt = formatTimestamp(connection.connectedAt);
  const expiresAt = formatTimestamp(connection.expiresAt);
  const isGmail = connection.provider.id === "gmail";

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
          {isGmail && actions ? (
            actions.configured ? (
              <>
                <p className={styles.manageCopy}>Google will ask for identity and Gmail send-only permission. Wolf Forge becomes Connected only after encrypted credentials and safe account metadata are saved successfully.</p>
                <ActionForm action={actions.connectPath} label="Connect Gmail" pendingAction={pendingAction} locked={locked} onSubmit={onSubmit} />
              </>
            ) : (
              <p className={styles.manageCopy}>Google Cloud OAuth and the trusted server credential are not configured in this environment. No connection can be created until the owner completes that server-only setup.</p>
            )
          ) : (
            <p className={styles.manageCopy}>This step does not create a connection record or store credentials. A future provider-specific setup will complete authorization on the server before the status can change.</p>
          )}
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
            <dt>Permissions</dt>
            <dd>{connection.grantedScopes.length > 0 ? connection.grantedScopes.join(", ") : "No provider permissions recorded"}</dd>
          </div>
          <div>
            <dt>Access token expiry</dt>
            <dd>{expiresAt ?? "Not reported"}</dd>
          </div>
        </dl>
      )}
      {connection.status !== "disconnected" && isGmail && actions ? (
        <div className={styles.connectionActions}>
          {connection.status === "connected" ? <ActionForm action={actions.verifyPath} label="Verify connection" pendingAction={pendingAction} locked={locked} onSubmit={onSubmit} secondary /> : null}
          {connection.status === "expired" || connection.status === "error" ? <ActionForm action={actions.connectPath} label="Reconnect Gmail" pendingAction={pendingAction} locked={locked} onSubmit={onSubmit} /> : null}
          <ActionForm action={actions.disconnectPath} label="Disconnect" pendingAction={pendingAction} locked={locked} onSubmit={onSubmit} danger />
        </div>
      ) : null}
    </div>
  );
}

function ActionForm({ action, label, pendingAction, locked, onSubmit, secondary = false, danger = false }: {
  action: string;
  label: string;
  pendingAction: string | null;
  locked: boolean;
  onSubmit: (action: string, event: FormEvent<HTMLFormElement>) => void;
  secondary?: boolean;
  danger?: boolean;
}) {
  const pending = pendingAction === action;
  return (
    <form method="post" action={action} onSubmit={(event) => onSubmit(action, event)}>
      <button type="submit" aria-busy={pending || undefined} disabled={locked || pendingAction !== null} className={danger ? styles.dangerButton : secondary ? styles.secondaryButton : styles.primaryButton}>
        {pending ? <LoaderCircle aria-hidden="true" /> : null}
        {pending ? `${label}…` : label}
      </button>
    </form>
  );
}

export function IntegrationProviderCard({
  connection,
  canManage,
  actions,
}: {
  connection: IntegrationConnectionView;
  canManage: boolean;
  actions?: IntegrationProviderActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const submissionStarted = useRef(false);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => {
    preparation.current?.abort();
    preparation.current = null;
  }, []);

  async function submit(action: string, event: FormEvent<HTMLFormElement>) {
    if (submissionStarted.current) {
      event.preventDefault();
      return;
    }
    submissionStarted.current = true;
    setPendingAction(action);
    if (action !== actions?.connectPath) return;
    event.preventDefault();
    const controller = new AbortController();
    preparation.current = controller;
    function recover(message: string) {
      setPendingAction(null);
      setRequiresReload(true);
      setNotice({ error: true, message });
    }
    const timer = window.setTimeout(() => {
      if (preparation.current !== controller) return;
      controller.abort();
      recover("Gmail setup took too long. Reload settings before trying again.");
    }, 30_000);
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Gmail setup unavailable");
      const payload: unknown = await response.json();
      if (controller.signal.aborted || preparation.current !== controller) return;
      if (!payload || typeof payload !== "object" || !("authorizationUrl" in payload)
        || typeof payload.authorizationUrl !== "string") throw new Error("Invalid Gmail setup");
      const destination = new URL(payload.authorizationUrl);
      if (destination.origin !== "https://accounts.google.com"
        || destination.pathname !== "/o/oauth2/v2/auth"
        || destination.username || destination.password || destination.hash) throw new Error("Invalid Gmail destination");
      window.clearTimeout(timer);
      // Commit recovery controls before navigation can freeze this document.
      flushSync(() => {
        setPendingAction(null);
        setRequiresReload(true);
        setNotice({ error: false, message: "Opening Google. If it does not open, reload settings before trying again." });
      });
      window.location.assign(destination.href);
    } catch {
      if (!controller.signal.aborted && preparation.current === controller) {
        recover("Gmail setup could not open. Reload settings before trying again.");
      }
    } finally {
      window.clearTimeout(timer);
      if (preparation.current === controller) preparation.current = null;
    }
  }
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
          {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? styles.errorNotice : styles.manageCopy}>{notice.message}</p> : null}
          {requiresReload ? <button type="button" className={`${styles.secondaryButton} ${styles.gmailReload}`} onClick={() => window.location.reload()}>Reload settings</button> : null}
          <IntegrationManagePanel connection={connection} actions={actions} pendingAction={pendingAction} locked={requiresReload} onSubmit={submit} />
        </div>
      ) : null}
    </article>
  );
}
