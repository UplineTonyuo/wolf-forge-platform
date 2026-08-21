import "server-only";

import { ApplicationError } from "../errors/application-error";

/**
 * Where PayPal will plug in. Nothing here calls PayPal.
 *
 * This file is a seam, not an integration. There is no PayPal SDK dependency,
 * no HTTP client, no credential read and no network call anywhere in it, and
 * `createPayPalGateway()` throws rather than pretending. That is deliberate:
 * a stub that silently succeeded would let a caller believe a payment happened.
 *
 * The port shape mirrors `StripeCustomerGateway` in `services/billing-service.ts`
 * — a narrow capability type owned by the platform, with the vendor adapter kept
 * behind it — so PayPal arrives the same way Stripe's identity phase did:
 *
 *   domain (payment-rails.ts)
 *     -> service orchestration, depending on this port
 *       -> this adapter, the only module allowed to touch PayPal
 *         -> PayPal
 *
 * THE INTENDED FLOW, for whoever implements it:
 *
 *   1. the server creates a PayPal Order for an invoice's outstanding balance
 *   2. the client approves it in PayPal's own hosted flow
 *   3. the server captures the approved order
 *   4. verified PayPal webhooks reconcile the payment back onto the invoice
 *
 * Wolf Forge stays the billing source of truth throughout. A capture is a
 * *payment against an existing Wolf Forge invoice*; PayPal never owns the
 * invoice, the amount, the currency, the plan or the status.
 *
 * WHAT THE IMPLEMENTATION MUST NOT DO, so it is written down before anyone
 * starts:
 *
 *   - never trust an amount, currency or invoice id sent by a browser; every
 *     one of them is re-read server-side from the invoice
 *   - never settle an invoice from a capture response alone; reconcile through
 *     a verified webhook, the way `app_pay_invoice_with_wallet` is the single
 *     audited path for the wallet
 *   - never let PAYPAL_CLIENT_SECRET or PAYPAL_WEBHOOK_ID leave this module;
 *     only PAYPAL_CLIENT_ID may ever appear in a browser, and only if a hosted
 *     PayPal button genuinely requires it
 *   - never persist a PayPal instrument, funding source or account identifier
 *     onto a payment rail; `ClientPaymentRail` has no field that could hold one
 */

/** An order is always for one Wolf Forge invoice. Amounts are re-read server-side. */
export type PayPalOrderRequest = {
  invoiceId: string;
  /** Idempotency key, the way `stripeCustomerIdempotencyKey` derives one. */
  requestId: string;
};

export type PayPalOrder = {
  orderId: string;
  /** Where the client is sent to approve. PayPal-hosted, never a Wolf Forge form. */
  approveUrl: string;
};

export type PayPalCapture = {
  orderId: string;
  captureId: string;
  status: "completed" | "pending" | "declined";
  amountCents: number;
  currency: string;
};

/**
 * The PayPal capability the platform will need, and nothing more.
 *
 * Three operations because the flow above has exactly three server-side steps.
 * No refunds, no saved funding sources, no subscriptions, no payouts and no
 * dispute handling: none of those has a caller, and an unused method on a port
 * is a decision made early with no information.
 */
export type PayPalGateway = {
  createOrder(request: PayPalOrderRequest): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalCapture>;
  /** Verifies a webhook signature against PAYPAL_WEBHOOK_ID. Server-side only. */
  verifyWebhook(headers: Record<string, string>, rawBody: string): Promise<boolean>;
};

/**
 * There is no PayPal gateway yet.
 *
 * Throws with a client-safe message and no configuration detail. Unreachable in
 * practice — every surface checks `readExternalPaymentRailAvailability()` first
 * and PayPal is never offered as usable — so reaching this is a programming
 * error, and it fails loudly instead of quietly returning a fake order.
 */
export function createPayPalGateway(): PayPalGateway {
  throw new ApplicationError(
    "VALIDATION_ERROR",
    "PayPal is not connected to Wolf Forge yet.",
  );
}
