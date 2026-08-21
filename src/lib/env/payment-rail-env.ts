import { z } from "zod";
import type { EnvironmentSource } from "./public-env";

/**
 * Configuration for the external payment rails.
 *
 * Its own reader, deliberately, for the same reason `stripe-env.ts` is its own
 * reader: `readServerEnvironment()` is called on paths that have nothing to do
 * with payments, and folding a payment variable into it would mean a developer
 * without PayPal configured could no longer boot those paths at all.
 *
 * `stripe-env.ts` is untouched by this file and is not imported by it. Stripe
 * is parked and is not a client-facing rail.
 *
 * NOTHING IS CONFIGURED TODAY. None of the variables named below exist in any
 * environment, which is precisely why `/account/payment-method` reports PayPal
 * as "Not connected yet" and bank transfer as "Not configured yet". Those
 * strings are derived from these functions, so they cannot go stale: connecting
 * a provider changes what the client sees without anyone editing a component.
 *
 * Every variable named here is server-side. None carries the NEXT_PUBLIC_
 * prefix, which is the bundler's own rule for what may reach a browser, so the
 * names themselves are the first guarantee that no secret can be shipped to a
 * client. This module is additionally only ever imported from server-only
 * modules under `src/lib/payments/`.
 */

/**
 * PayPal, when it is connected.
 *
 * All three are required together. A client id without a secret cannot create
 * an order, and a client id and secret without a webhook id cannot verify the
 * callbacks that reconcile a capture — a half-configured provider that
 * advertised itself as available would be the exact "fake success" this model
 * exists to prevent.
 *
 * Shape is checked loosely and only enough to catch a placeholder or an empty
 * string committed by mistake. No value is ever logged, echoed or returned.
 */
const paypalEnvironmentSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().trim().min(1),
  /*
   * Never NEXT_PUBLIC_, never returned from any function in this file, never
   * placed on a component prop. `readPayPalEnvironment` is the only accessor,
   * it is called from server-only modules, and today it has no caller at all.
   */
  PAYPAL_CLIENT_SECRET: z.string().trim().min(1),
  PAYPAL_WEBHOOK_ID: z.string().trim().min(1),
});

export type PayPalEnvironment = z.infer<typeof paypalEnvironmentSchema>;

/**
 * Throws when PayPal is not configured.
 *
 * The error names the variable and never includes its value, so a stack trace
 * or a log line cannot leak a credential. Currently unreferenced by design: the
 * only thing that would call it is a real PayPal request, and this phase makes
 * none.
 */
export function readPayPalEnvironment(
  source: EnvironmentSource = process.env,
): PayPalEnvironment {
  return paypalEnvironmentSchema.parse(source);
}

/** True when PayPal could actually be called. Never reveals which part is set. */
export function isPayPalConfigured(source: EnvironmentSource = process.env): boolean {
  return paypalEnvironmentSchema.safeParse(source).success;
}

/**
 * How Wolf Forge would accept a bank transfer.
 *
 * Two futures, one rail. The client-facing identity is "Bank Transfer" in both
 * cases, so switching between them later changes how the payment is executed,
 * never what the client is choosing:
 *
 *   manual    Wolf Forge publishes transfer instructions and reconciles the
 *             payment by hand. This is what William means today.
 *   provider  an automated bank/payment provider executes the transfer.
 *             Nothing here assumes ACH, Plaid, SEPA, open banking or any
 *             particular vendor; picking one is a later decision.
 *
 * Deliberately NOT a place to store bank details. Whichever mode is chosen, the
 * account number, IBAN, routing number and sort code live wherever Wolf Forge
 * chooses to hold them later — this repository holds none of them, invents none
 * of them, and no rail field can carry one.
 */
export const bankTransferModes = ["manual", "provider"] as const;

export type BankTransferMode = (typeof bankTransferModes)[number];

const bankTransferEnvironmentSchema = z.object({
  BANK_TRANSFER_MODE: z.enum(bankTransferModes),
});

/**
 * The declared bank transfer mode, or null when Wolf Forge has not declared one.
 *
 * Null today, on every environment. Opt-in on purpose: the rail becomes
 * available only when an operator states that Wolf Forge is genuinely ready to
 * accept a transfer, so no stray default can flip it on.
 */
export function readBankTransferMode(
  source: EnvironmentSource = process.env,
): BankTransferMode | null {
  const parsed = bankTransferEnvironmentSchema.safeParse(source);
  return parsed.success ? parsed.data.BANK_TRANSFER_MODE : null;
}

export function isBankTransferConfigured(source: EnvironmentSource = process.env): boolean {
  return readBankTransferMode(source) !== null;
}
