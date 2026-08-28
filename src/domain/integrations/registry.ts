export const INTEGRATION_PROVIDER_IDS = ["gmail", "stripe", "paypal"] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

export type IntegrationProviderDefinition = {
  id: IntegrationProviderId;
  name: string;
  iconKey: IntegrationProviderId;
  description: string;
  capabilities: readonly string[];
  configurationSummary: string;
};

/**
 * Canonical, non-secret provider metadata shared by server and presentation.
 * Provider adapters consume the same ids; components never carry a second
 * provider-name/description map that can drift from this registry.
 */
export const INTEGRATION_PROVIDER_REGISTRY = {
  gmail: {
    id: "gmail",
    name: "Gmail",
    iconKey: "gmail",
    description: "Prepare client and account communication through a connected Google mailbox.",
    capabilities: ["Mailbox identity", "Email delivery", "Consent scopes"],
    configurationSummary: "Google OAuth runs on the server with send-only Gmail permission and encrypted credential storage.",
  },
  stripe: {
    id: "stripe",
    name: "Stripe",
    iconKey: "stripe",
    description: "Prepare secure payment processing for future Store, Invoice, and Subscription flows.",
    capabilities: ["Payment processing", "Merchant identity", "Webhook readiness"],
    configurationSummary: "Stripe account authorization and webhooks are not configured yet.",
  },
  paypal: {
    id: "paypal",
    name: "PayPal",
    iconKey: "paypal",
    description: "Prepare PayPal as an external payment provider without changing billing semantics.",
    capabilities: ["Payment processing", "Merchant identity", "Webhook readiness"],
    configurationSummary: "PayPal account authorization and webhooks are not configured yet.",
  },
} as const satisfies Record<IntegrationProviderId, IntegrationProviderDefinition>;

export const INTEGRATION_PROVIDERS: readonly IntegrationProviderDefinition[] =
  INTEGRATION_PROVIDER_IDS.map((providerId) => INTEGRATION_PROVIDER_REGISTRY[providerId]);

export function isIntegrationProviderId(value: string): value is IntegrationProviderId {
  return (INTEGRATION_PROVIDER_IDS as readonly string[]).includes(value);
}

export function integrationProvider(providerId: IntegrationProviderId): IntegrationProviderDefinition {
  return INTEGRATION_PROVIDER_REGISTRY[providerId];
}
