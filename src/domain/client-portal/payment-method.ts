/**
 * Client payment-method state.
 *
 * ABSOLUTE RULE encoded here: Wolf Forge has no card payment provider. There is
 * no Stripe integration, no PayPal integration, no tokenisation endpoint and no
 * table that stores a card brand, last four digits or an expiry date. Nothing
 * in the portal may therefore display one.
 *
 * The state machine below is written out in full anyway, because the honest
 * answer today ("no payment method on file") and the answer after an
 * integration lands ("Visa •••• 4242, default") are the same question. Encoding
 * every state now means the future integration supplies data instead of
 * rewriting screens — and, more importantly, means the empty state is a
 * *computed* result rather than hardcoded copy that someone could later forget
 * to remove.
 *
 * What must never happen here, whatever is added later:
 *   - no full card number, anywhere, ever
 *   - no CVV, anywhere, ever
 *   - no raw card entry in a Wolf Forge form; provider-hosted or tokenised
 *     elements only
 *   - only safe provider-issued identifiers (brand, last4, expiry, token id)
 *     may be persisted
 */

export type OnlinePaymentProviderId = "stripe" | "paypal";

/**
 * Online payment providers that are actually connected.
 *
 * Empty. This is the single fact the whole surface derives from — resolving the
 * state through this constant is what guarantees no screen can show a card
 * while the array is empty. Integrating a provider means adding its id here
 * *and* supplying real methods; neither alone changes what a client sees.
 */
export const connectedOnlinePaymentProviders: readonly OnlinePaymentProviderId[] = [];

/**
 * A payment method as a provider would report it.
 *
 * Every field is provider-issued and safe to store. There is deliberately no
 * field on this type that could hold a full card number or a security code —
 * the shape itself refuses them.
 */
export type StoredPaymentMethod = {
  id: string;
  providerId: OnlinePaymentProviderId;
  /** Provider-supplied brand, e.g. "Visa". Never inferred from a card number. */
  brand: string;
  /** Provider-supplied last four digits. */
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
};

export type PaymentMethodState =
  /** A. No provider is connected at all. */
  | { kind: "no_provider" }
  /** B. A provider exists but the account has stored nothing. */
  | { kind: "provider_no_method"; providers: readonly OnlinePaymentProviderId[] }
  /** C / E. A default method exists; any others are secondary. */
  | { kind: "method_on_file"; method: StoredPaymentMethod; others: StoredPaymentMethod[] }
  /** D. The default method cannot be charged as-is. */
  | {
      kind: "needs_attention";
      method: StoredPaymentMethod;
      others: StoredPaymentMethod[];
      reason: "expired";
    };

function isExpired(method: StoredPaymentMethod, now: Date): boolean {
  // A card is valid through the last day of its expiry month.
  const expiresAfter = new Date(Date.UTC(method.expiryYear, method.expiryMonth, 1));
  return now.getTime() >= expiresAfter.getTime();
}

export function resolvePaymentMethodState({
  providers = connectedOnlinePaymentProviders,
  methods = [],
  now = new Date(),
}: {
  providers?: readonly OnlinePaymentProviderId[];
  methods?: StoredPaymentMethod[];
  now?: Date;
} = {}): PaymentMethodState {
  if (providers.length === 0) return { kind: "no_provider" };

  // A method whose provider is not connected is not chargeable, so it is not
  // shown. Stale rows from a disconnected provider cannot leak onto the screen.
  const usable = methods.filter((method) => providers.includes(method.providerId));
  if (usable.length === 0) return { kind: "provider_no_method", providers };

  const preferred = usable.find((method) => method.isDefault) ?? usable[0]!;
  const others = usable.filter((method) => method.id !== preferred.id);

  return isExpired(preferred, now)
    ? { kind: "needs_attention", method: preferred, others, reason: "expired" }
    : { kind: "method_on_file", method: preferred, others };
}

/**
 * The Wolf Forge wallet, which *is* real.
 *
 * Distinct from the card states above: this is an internal balance funded by
 * Wolf Forge, settled by app_pay_invoice_with_wf_card, and it is the only way
 * an invoice can currently be paid from the portal. It is not an online payment
 * provider and is never presented as one.
 */
export type WalletFundingState = {
  membershipStatus: "inactive" | "pending" | "active" | "cancelled";
  balanceCents: number;
  currency: string;
  /** True only when the membership is active — the gate the RPC itself enforces. */
  canSettleInvoices: boolean;
};

export function resolveWalletFunding(input: {
  membershipStatus: WalletFundingState["membershipStatus"] | null;
  balanceCents: number;
  currency: string;
}): WalletFundingState {
  const membershipStatus = input.membershipStatus ?? "inactive";
  return {
    membershipStatus,
    balanceCents: input.balanceCents,
    currency: input.currency,
    canSettleInvoices: membershipStatus === "active",
  };
}
