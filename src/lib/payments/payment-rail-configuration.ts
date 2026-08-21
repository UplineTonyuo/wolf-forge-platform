import "server-only";

import {
  externalPaymentRailAvailability,
  type ExternalPaymentRailAvailability,
} from "../../domain/payments/payment-rails";
import type { EnvironmentSource } from "../env/public-env";
import { isBankTransferConfigured, isPayPalConfigured } from "../env/payment-rail-env";

/**
 * Which external payment rails Wolf Forge can actually accept.
 *
 * `import "server-only"` is the hard boundary, the same one `stripe-client.ts`
 * and `next-server.ts` use: if a client component ever pulls this module into
 * its graph the build fails rather than shipping provider configuration to a
 * browser.
 *
 * This module reads the environment and does nothing else. The mapping from
 * configuration to availability is pure and lives in the domain, so the rule can
 * be tested without a secret and without crossing this boundary.
 *
 * What crosses to the browser is the *result*, never the input: two enum
 * strings. No credential, no variable name, no partial state and no "which half
 * is missing" hint can travel with it — a client learns that PayPal is not
 * connected, which is exactly what the page tells them out loud anyway.
 *
 * Availability is read here rather than written into a component so it cannot
 * lie in either direction. Today both rails are unavailable on every
 * environment, and that is a computed result: no PayPal variables exist and no
 * bank transfer mode is declared.
 */
export function readExternalPaymentRailAvailability(
  source: EnvironmentSource = process.env,
): ExternalPaymentRailAvailability {
  return externalPaymentRailAvailability({
    /* Requires the client id, the secret AND the webhook id together — see the
       reasoning in lib/env/payment-rail-env.ts. */
    paypalConfigured: isPayPalConfigured(source),
    /* Declaring a mode is what makes bank transfer available; nothing defaults on. */
    bankTransferConfigured: isBankTransferConfigured(source),
  });
}
