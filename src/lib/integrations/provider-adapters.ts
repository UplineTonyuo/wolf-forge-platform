import "server-only";

import type { IntegrationConnectionView } from "../../domain/integrations/schema";
import {
  INTEGRATION_PROVIDER_IDS,
  type IntegrationProviderId,
} from "../../domain/integrations/registry";
import type { IntegrationCredentialStore } from "./credential-store";

export type IntegrationProviderAdapter = {
  provider: IntegrationProviderId;
  implementationStatus: "foundation" | "configured";
  supportsConnect: boolean;
  supportsDisconnect: boolean;
  disconnect(
    connection: IntegrationConnectionView,
    credentials: IntegrationCredentialStore,
  ): Promise<void>;
};

function foundationAdapter(provider: IntegrationProviderId): IntegrationProviderAdapter {
  return {
    provider,
    implementationStatus: "foundation",
    supportsConnect: false,
    supportsDisconnect: false,
    async disconnect() {
      throw new Error(`${provider} disconnect handling is not configured.`);
    },
  };
}

/** Server-only adapter registry. No provider SDK or live API is invoked yet. */
export const INTEGRATION_PROVIDER_ADAPTERS = Object.fromEntries(
  INTEGRATION_PROVIDER_IDS.map((providerId) => [providerId, foundationAdapter(providerId)]),
) as Record<IntegrationProviderId, IntegrationProviderAdapter>;
