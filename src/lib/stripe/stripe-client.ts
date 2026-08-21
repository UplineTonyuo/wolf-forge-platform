import "server-only";

import Stripe from "stripe";
import { readStripeEnvironment } from "../env/stripe-env";

/**
 * The server-only Stripe client.
 *
 * `import "server-only"` is the hard boundary: if any client component ever
 * pulls this module into its graph, the build fails rather than shipping a
 * secret key to a browser. That is the same guard `next-server.ts` uses for the
 * Supabase server context.
 *
 * Constructed lazily and memoised. Nothing is read from the environment at
 * import time, so a developer with no Stripe key configured can still run the
 * app; only a code path that genuinely reaches Stripe will fail, and it will
 * fail naming the missing variable.
 */
let cached: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cached) return cached;

  const environment = readStripeEnvironment();

  cached = new Stripe(environment.STRIPE_SECRET_KEY, {
    /*
     * Identifies this integration in Stripe's dashboard request logs, which is
     * what makes a stray call traceable back to the platform later.
     */
    appInfo: { name: "Wolf Forge Platform" },
    /*
     * A short, bounded number of automatic retries. Stripe's own idempotency
     * handling makes these safe, and the customer-creation call additionally
     * carries an explicit idempotency key.
     */
    maxNetworkRetries: 2,
  });

  return cached;
}

/** Test seam: drops the memoised client so a suite can re-read the environment. */
export function resetStripeClientForTests(): void {
  cached = null;
}
