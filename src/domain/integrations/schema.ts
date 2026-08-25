import {
  INTEGRATION_PROVIDERS,
  isIntegrationProviderId,
  type IntegrationProviderDefinition,
  type IntegrationProviderId,
} from "./registry";

export const INTEGRATION_CONNECTION_STATUSES = [
  "connected",
  "disconnected",
  "error",
  "expired",
] as const;

export type IntegrationConnectionStatus = (typeof INTEGRATION_CONNECTION_STATUSES)[number];

/** Exact safe projection returned by app_list_integration_connections(). */
export type IntegrationConnectionRow = {
  id: string;
  provider: string;
  status: string;
  connected_account_id: string | null;
  connected_account_display: string | null;
  connected_by_profile_id: string | null;
  connected_at: string | null;
  updated_at: string;
  last_synced_at: string | null;
  expires_at: string | null;
  granted_scopes: string[];
};

/**
 * Client-safe connection state. This intentionally has no metadata bag and no
 * credential-like field, so tokens cannot be forwarded through page props by
 * accident when the credential store is implemented later.
 */
export type IntegrationConnectionView = {
  provider: IntegrationProviderDefinition;
  connectionId: string | null;
  status: IntegrationConnectionStatus;
  connectedAccountDisplay: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  expiresAt: string | null;
  grantedScopes: readonly string[];
};

export function isIntegrationConnectionStatus(value: string): value is IntegrationConnectionStatus {
  return (INTEGRATION_CONNECTION_STATUSES as readonly string[]).includes(value);
}

function disconnectedView(provider: IntegrationProviderDefinition): IntegrationConnectionView {
  return {
    provider,
    connectionId: null,
    status: "disconnected",
    connectedAccountDisplay: null,
    connectedAt: null,
    updatedAt: null,
    lastSyncedAt: null,
    expiresAt: null,
    grantedScopes: [],
  };
}

/**
 * Derives every card from persisted metadata. An absent or malformed row is
 * always Disconnected; no UI action or optimistic state can manufacture a
 * Connected result.
 */
export function toIntegrationConnectionViews(
  rows: readonly IntegrationConnectionRow[],
): IntegrationConnectionView[] {
  const persisted = new Map<IntegrationProviderId, IntegrationConnectionRow>();

  for (const row of rows) {
    if (isIntegrationProviderId(row.provider) && isIntegrationConnectionStatus(row.status)) {
      persisted.set(row.provider, row);
    }
  }

  return INTEGRATION_PROVIDERS.map((provider) => {
    const row = persisted.get(provider.id);
    if (!row) return disconnectedView(provider);

    return {
      provider,
      connectionId: row.id,
      status: row.status as IntegrationConnectionStatus,
      connectedAccountDisplay: row.connected_account_display,
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
      lastSyncedAt: row.last_synced_at,
      expiresAt: row.expires_at,
      grantedScopes: [...row.granted_scopes],
    };
  });
}

export function integrationStatusLabel(status: IntegrationConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "error":
      return "Needs attention";
    case "expired":
      return "Reauthorization required";
    default:
      return "Not connected";
  }
}
