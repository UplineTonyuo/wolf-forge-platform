import "server-only";

import type { IntegrationProviderId } from "../../domain/integrations/registry";

/**
 * Opaque provider credential material. Only provider adapters and a configured
 * server-side store implementation may interpret its payload. This module can
 * never be imported into a Client Component because of `server-only`.
 */
export type ProviderCredentialEnvelope = {
  provider: IntegrationProviderId;
  version: number;
  payload: Readonly<Record<string, unknown>>;
};

export interface IntegrationCredentialStore {
  read(provider: IntegrationProviderId): Promise<ProviderCredentialEnvelope | null>;
  write(credentials: ProviderCredentialEnvelope): Promise<void>;
  delete(provider: IntegrationProviderId): Promise<void>;
}

/**
 * Foundation default for providers without a configured encrypted store. Gmail
 * now uses GmailVaultCredentialStore; Stripe and PayPal continue to fail closed.
 */
export class UnconfiguredIntegrationCredentialStore implements IntegrationCredentialStore {
  async read(): Promise<never> {
    throw new Error("Integration credential storage is not configured.");
  }

  async write(): Promise<never> {
    throw new Error("Integration credential storage is not configured.");
  }

  async delete(): Promise<never> {
    throw new Error("Integration credential storage is not configured.");
  }
}
