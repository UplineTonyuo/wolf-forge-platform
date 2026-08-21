import { z } from "zod";
import type { EnvironmentSource } from "./public-env";

/**
 * Stripe's server-side configuration.
 *
 * Deliberately its own reader rather than another field on `serverSecretSchema`.
 * `readServerEnvironment()` is called on paths that have nothing to do with
 * billing — auth administration, for one — and folding a Stripe key into it
 * would mean a developer without Stripe configured could no longer boot those
 * paths at all. Billing is the only thing that should fail when Stripe is
 * missing, so only billing reads this.
 *
 * Read lazily, at the moment a Stripe call is actually about to happen, which
 * matches the existing convention: every environment reader in this directory
 * is a function rather than a module-level constant.
 *
 * There is no publishable key here and no webhook secret. Phase 1 has no
 * browser-side Stripe surface and no webhook endpoint, so neither would have a
 * caller — and an unused secret in the environment is a liability, not a
 * head start.
 */
const stripeEnvironmentSchema = z.object({
  /*
   * Never NEXT_PUBLIC_. The Next bundler only exposes variables carrying that
   * prefix to the browser, so the name itself is the first guarantee that this
   * value cannot reach a client bundle.
   */
  STRIPE_SECRET_KEY: z
    .string()
    .trim()
    .min(1)
    /*
     * Shape only, and only enough to catch a key pasted into the wrong slot.
     * `sk_` is a live or test secret key; `rk_` is a restricted key, which is a
     * legitimate and tighter choice for this integration. A publishable key
     * (`pk_`) is rejected outright — it cannot perform these calls and its
     * presence here would mean the operator misread the setup.
     */
    .regex(
      /^(sk|rk)_[A-Za-z0-9_]+$/u,
      "STRIPE_SECRET_KEY must be a Stripe secret or restricted key.",
    ),
});

export type StripeEnvironment = z.infer<typeof stripeEnvironmentSchema>;

/**
 * Throws when Stripe is not configured.
 *
 * The error names the variable and never includes its value, so a stack trace
 * or a log line cannot leak the key.
 */
export function readStripeEnvironment(
  source: EnvironmentSource = process.env,
): StripeEnvironment {
  return stripeEnvironmentSchema.parse(source);
}

/** True when billing can run. Lets a caller degrade instead of throwing. */
export function isStripeConfigured(source: EnvironmentSource = process.env): boolean {
  return stripeEnvironmentSchema.safeParse(source).success;
}
