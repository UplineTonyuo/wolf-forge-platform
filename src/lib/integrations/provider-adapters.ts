import "server-only";

import {
  INTEGRATION_PROVIDER_IDS,
  type IntegrationProviderId,
} from "../../domain/integrations/registry";

export type IntegrationProviderAdapter = {
  provider: IntegrationProviderId;
  implementationStatus: "foundation" | "live";
  supportsConnect: boolean;
  supportsDisconnect: boolean;
  supportsVerification: boolean;
  supportsSend: boolean;
};

function foundationAdapter(provider: IntegrationProviderId): IntegrationProviderAdapter {
  return {
    provider,
    implementationStatus: "foundation",
    supportsConnect: false,
    supportsDisconnect: false,
    supportsVerification: false,
    supportsSend: false,
  };
}

/** Server-only capability registry; live behavior is implemented by each provider adapter/service. */
export const INTEGRATION_PROVIDER_ADAPTERS: Record<IntegrationProviderId, IntegrationProviderAdapter> = {
  ...Object.fromEntries(INTEGRATION_PROVIDER_IDS.map((providerId) => [providerId, foundationAdapter(providerId)])) as Record<IntegrationProviderId, IntegrationProviderAdapter>,
  gmail: {
    provider: "gmail",
    implementationStatus: "live",
    supportsConnect: true,
    supportsDisconnect: true,
    supportsVerification: true,
    supportsSend: true,
  },
};
