import "server-only";

import type { StripeCustomerGateway } from "../../services/billing-service";
import { getStripeClient } from "./stripe-client";

/**
 * The real Stripe adapter behind `StripeCustomerGateway`.
 *
 * Kept apart from the service so the only module that touches the SDK — and
 * therefore the only one carrying `server-only` — is this one. The service can
 * then be unit tested with a stub and no key.
 */
export function createStripeCustomerGateway(): StripeCustomerGateway {
  return {
    async createCustomer(profile, options) {
      const customer = await getStripeClient().customers.create(
        {
          name: profile.name,
          ...(profile.email ? { email: profile.email } : {}),
          metadata: profile.metadata,
        },
        { idempotencyKey: options.idempotencyKey },
      );

      return { id: customer.id };
    },
  };
}
