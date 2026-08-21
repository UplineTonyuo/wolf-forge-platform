import { formatCurrencyCents } from "../../lib/format";

/**
 * The client-facing payment rails.
 *
 * A "rail" is how money reaches Wolf Forge, named the way a client would name
 * it. It is deliberately NOT the same concept as a stored card: a rail exists
 * whether or not the account has ever used it, and two of the three below
 * cannot move money at all yet.
 *
 * Three rails, and only three:
 *
 *   wf_balance      real, and the default. An internal balance settled by
 *                   app_pay_invoice_with_wallet. This is the only rail that can
 *                   currently pay an invoice, and this module does not change
 *                   that.
 *   paypal          intended. No PayPal API is called anywhere in the platform;
 *                   see src/lib/payments/paypal-gateway.ts for the seam.
 *   bank_transfer   intended. Ordinary bank-to-bank payment. No banking API, no
 *                   ACH provider and no open-banking aggregator is assumed.
 *
 * Stripe is deliberately absent. The Stripe Phase 1 work
 * (domain/billing/stripe-customer.ts) is a company to Customer mapping with no
 * client surface, and it is parked — surfacing "Card" here would advertise a
 * capability that does not exist.
 *
 * ABSOLUTE RULES this model encodes, carried over from
 * domain/client-portal/payment-method.ts:
 *
 *   - no full card number, no CVV, no IBAN, no account number, no routing
 *     number and no sort code, ever, in any field of any type below
 *   - no provider credential, secret, key or token of any kind
 *   - availability is a fact supplied by the server, never a literal written
 *     into a component
 *
 * The shapes below cannot hold any of those: every field is either an
 * identifier this repository owns, a label, or a figure the platform already
 * shows elsewhere.
 */

export const paymentRailIds = ["wf_balance", "paypal", "bank_transfer"] as const;

export type PaymentRailId = (typeof paymentRailIds)[number];

/** Rails supplied by someone other than Wolf Forge. */
export type ExternalPaymentRailId = Exclude<PaymentRailId, "wf_balance">;

/**
 * Why a rail can or cannot be used right now.
 *
 * One vocabulary for all three rails, so a surface never has to guess which
 * flavour of "no" it is looking at:
 *
 *   available            usable today
 *   membership_required  wf_balance only. The wallet exists but WF Card
 *                        membership is not active, which is the gate
 *                        app_pay_invoice_with_wallet itself enforces.
 *   not_connected        paypal. Wolf Forge has not connected a PayPal account.
 *   not_configured       bank_transfer. Wolf Forge has not published bank
 *                        transfer details or connected a bank provider.
 */
export type PaymentRailStatus =
  | "available"
  | "membership_required"
  | "not_connected"
  | "not_configured";

/** Availability of the external rails, as the server reports it. */
export type ExternalPaymentRailAvailability = Record<ExternalPaymentRailId, PaymentRailStatus>;

/**
 * Configuration, turned into availability.
 *
 * Pure, and kept here rather than inside the `server-only` module that reads
 * the environment, so the mapping itself is directly testable — the reason
 * `stripe-customer.ts` holds Stripe's pure rules while `lib/stripe/**` holds
 * the SDK. The server module supplies two booleans and nothing else; no
 * credential, variable name or partial state can reach this function, let alone
 * the client props built from its result.
 *
 * Note the asymmetry in the two "no" words, which is not cosmetic:
 * PayPal is an account Wolf Forge has not *connected*, while bank transfer is
 * something Wolf Forge has not *configured* — there is nothing to connect to,
 * only details to publish or a provider to choose.
 */
export function externalPaymentRailAvailability(configuration: {
  paypalConfigured: boolean;
  bankTransferConfigured: boolean;
}): ExternalPaymentRailAvailability {
  return {
    paypal: configuration.paypalConfigured ? "available" : "not_connected",
    bank_transfer: configuration.bankTransferConfigured ? "available" : "not_configured",
  };
}

/**
 * The wallet facts a rail needs.
 *
 * Structurally identical to WalletFundingState in
 * domain/client-portal/payment-method.ts and accepted as that type by callers;
 * restated here so this module does not depend on the card-era state machine it
 * sits beside.
 */
export type WalletRailInput = {
  membershipStatus: "inactive" | "pending" | "active" | "cancelled";
  balanceCents: number;
  currency: string;
  canSettleInvoices: boolean;
};

/**
 * One rail, ready to render.
 *
 * `detail` is the only field carrying a number, and the only number it may ever
 * carry is a balance the platform already shows on the invoice page and the
 * wallet card. There is no field here for an account identifier, and adding one
 * would be a change to this type that a reviewer would see.
 */
export type ClientPaymentRail = {
  id: PaymentRailId;
  label: string;
  /** One line explaining what the rail is. Never a status. */
  description: string;
  status: PaymentRailStatus;
  /** True only when the rail can actually settle an invoice today. */
  isAvailable: boolean;
  /** True for the account's default rail, whether or not it is available. */
  isDefault: boolean;
  /** True for the rail currently chosen in the selector. Presentation only. */
  isSelected: boolean;
  /** Safe supporting figure, e.g. "$500.00 available". Null when there is none. */
  detail: string | null;
  /** Short truthful state, e.g. "Not connected yet". Null when available. */
  statusLabel: string | null;
};

/**
 * The default rail, and it is not a preference.
 *
 * Wolf Forge Balance is the account's payment method because it is the only one
 * Wolf Forge can settle against. It is the default at a zero balance and it is
 * the default while membership is inactive — a rail that is temporarily unusable
 * is still the account's rail, and hiding it would leave the portal claiming the
 * account has no payment method at all, which is the untruth this replaces.
 */
export const defaultPaymentRailId: PaymentRailId = "wf_balance";

const railCopy: Record<PaymentRailId, { label: string; description: string }> = {
  wf_balance: {
    label: "Wolf Forge Balance",
    description: "Settle any invoice instantly from your Wolf Forge account balance.",
  },
  paypal: {
    label: "PayPal",
    description: "Pay with PayPal.",
  },
  bank_transfer: {
    label: "Bank Transfer",
    description: "Pay by bank transfer.",
  },
};

const statusCopy: Record<Exclude<PaymentRailStatus, "available">, string> = {
  membership_required: "Membership not active",
  not_connected: "Not connected yet",
  not_configured: "Not configured yet",
};

export function paymentRailStatusLabel(status: PaymentRailStatus): string | null {
  return status === "available" ? null : statusCopy[status];
}

/**
 * The wallet's rail status.
 *
 * Mirrors the gate the database enforces rather than restating it: the RPC
 * refuses a non-member, so a non-member's rail is not available here either. A
 * zero balance is NOT a status — the account still holds the rail, and the
 * figure tells the truth on its own.
 */
export function walletRailStatus(wallet: WalletRailInput): PaymentRailStatus {
  return wallet.canSettleInvoices ? "available" : "membership_required";
}

/**
 * The full rail list for a client, in presentation order.
 *
 * Order is fixed: the default first, then the external rails in the order Wolf
 * Forge intends to offer them. It does not reorder by availability, because a
 * list that rearranges itself when a provider connects would move the option a
 * returning client is reaching for.
 */
export function composeClientPaymentRails({
  wallet,
  availability,
  selectedRailId = defaultPaymentRailId,
}: {
  wallet: WalletRailInput;
  availability: ExternalPaymentRailAvailability;
  /** Presentation only. See resolveSelectedPaymentRailId. */
  selectedRailId?: PaymentRailId | null;
}): ClientPaymentRail[] {
  const statuses: Record<PaymentRailId, PaymentRailStatus> = {
    wf_balance: walletRailStatus(wallet),
    paypal: availability.paypal,
    bank_transfer: availability.bank_transfer,
  };

  const selected = resolveSelectedPaymentRailId(selectedRailId, statuses);

  return paymentRailIds.map((id) => {
    const status = statuses[id];

    return {
      id,
      label: railCopy[id].label,
      description: railCopy[id].description,
      status,
      isAvailable: status === "available",
      isDefault: id === defaultPaymentRailId,
      isSelected: id === selected,
      /*
       * Only the wallet carries a figure, and it carries the real one at every
       * value including zero. PayPal and bank transfer carry nothing, because
       * the platform holds no PayPal account, no bank account and no stored
       * instrument for either — anything printed there would be invented.
       */
      detail:
        id === "wf_balance"
          ? `${formatCurrencyCents(wallet.balanceCents, wallet.currency)} available`
          : null,
      statusLabel: paymentRailStatusLabel(status),
    };
  });
}

/**
 * The rail a selector may show as chosen.
 *
 * A rail that cannot be used cannot be selected, so a request for an
 * unavailable one falls back to the default rather than being honoured. This is
 * what stops the portal from displaying "PayPal" as this account's payment
 * method while no PayPal account exists — including if a selection were ever
 * persisted, restored from storage or arrived from a URL.
 */
export function resolveSelectedPaymentRailId(
  requested: PaymentRailId | null | undefined,
  statuses: Record<PaymentRailId, PaymentRailStatus>,
): PaymentRailId {
  if (!requested) return defaultPaymentRailId;
  if (!paymentRailIds.includes(requested)) return defaultPaymentRailId;
  return statuses[requested] === "available" ? requested : defaultPaymentRailId;
}

/** The rail a surface should present as the account's payment method. */
export function primaryPaymentRail(rails: ClientPaymentRail[]): ClientPaymentRail | null {
  return rails.find((rail) => rail.isDefault) ?? rails[0] ?? null;
}

/** Everything that is not the default, in order. */
export function alternativePaymentRails(rails: ClientPaymentRail[]): ClientPaymentRail[] {
  return rails.filter((rail) => !rail.isDefault);
}

/**
 * True when at least one rail other than the default can be used.
 *
 * Drives honest copy in the selector: while this is false the client is being
 * shown what is coming rather than offered a choice, and the UI says so instead
 * of presenting a save action that would change nothing.
 */
export function hasAlternativePaymentRail(rails: ClientPaymentRail[]): boolean {
  return alternativePaymentRails(rails).some((rail) => rail.isAvailable);
}
