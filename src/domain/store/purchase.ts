import type { StoreServiceView } from "../services/store-projections";
import type { WfCardMembershipStatus } from "../wf-card/schema";

/**
 * Whether the Store may offer a real Purchase action, and what it must say when
 * it may not.
 *
 * This is a projection of the database's own refusals, not a second opinion.
 * public.app_purchase_service_with_balance rejects a recurring, unpriced,
 * inactive or private Service, a company without an active WF Card membership,
 * and a balance below the catalogue price — each with its own error. Every
 * branch below mirrors one of those, so the button is absent or disabled exactly
 * where the RPC would refuse.
 *
 * It is deliberately NOT the authorization. The client cannot reach the money by
 * defeating this; a crafted request meets the same checks again in the database,
 * where the price and the balance are re-resolved from the catalogue and the
 * wallet rather than from anything the browser sent.
 */

export type StorePurchaseBlockedReason =
  | "recurring"
  | "unpriced"
  | "membership_inactive"
  | "insufficient_balance"
  | "balance_unknown";

export type StorePurchaseOffer =
  | {
      purchasable: true;
      priceCents: number;
      currency: string;
      balanceCents: number;
      /** What the client is left with. Only ever shown for a real balance. */
      balanceAfterCents: number;
    }
  | {
      purchasable: false;
      reason: StorePurchaseBlockedReason;
      priceCents: number;
      currency: string;
      /** Null when the balance could not be securely resolved. */
      balanceCents: number | null;
      /** Only meaningful for insufficient_balance. */
      shortfallCents: number | null;
    };

export function toPriceCents(amount: number): number {
  return Math.round(amount * 100);
}

export function resolveStorePurchaseOffer({
  service,
  balanceCents,
  walletCurrency,
  membershipStatus,
}: {
  service: Pick<StoreServiceView, "amount" | "currency" | "recurring">;
  /**
   * Null when the wallet could not be read — a denied module, a failed request.
   * The dialog must never invent a "balance after" from a number it does not
   * have, so this stays nullable all the way through.
   */
  balanceCents: number | null;
  walletCurrency: string | null;
  membershipStatus: WfCardMembershipStatus | null;
}): StorePurchaseOffer {
  const priceCents = toPriceCents(service.amount);
  const currency = service.currency;

  // A recurring catalogue entry is a subscription, and this phase does not sell
  // subscriptions. Saying so is better than offering a button that fails.
  if (service.recurring) {
    return {
      purchasable: false,
      reason: "recurring",
      priceCents,
      currency,
      balanceCents,
      shortfallCents: null,
    };
  }

  if (priceCents <= 0) {
    return {
      purchasable: false,
      reason: "unpriced",
      priceCents,
      currency,
      balanceCents,
      shortfallCents: null,
    };
  }

  if (membershipStatus !== "active") {
    return {
      purchasable: false,
      reason: "membership_inactive",
      priceCents,
      currency,
      balanceCents,
      shortfallCents: null,
    };
  }

  // A balance we could not read is not a balance of zero. Refusing to guess is
  // what keeps "Balance after purchase" honest.
  if (balanceCents === null || walletCurrency === null || walletCurrency !== currency) {
    return {
      purchasable: false,
      reason: "balance_unknown",
      priceCents,
      currency,
      balanceCents: null,
      shortfallCents: null,
    };
  }

  if (balanceCents < priceCents) {
    return {
      purchasable: false,
      reason: "insufficient_balance",
      priceCents,
      currency,
      balanceCents,
      shortfallCents: priceCents - balanceCents,
    };
  }

  return {
    purchasable: true,
    priceCents,
    currency,
    balanceCents,
    balanceAfterCents: balanceCents - priceCents,
  };
}

/** The one line the Store shows when it cannot offer the button. */
export function storePurchaseBlockedLabel(reason: StorePurchaseBlockedReason): string {
  switch (reason) {
    case "recurring":
      return "Recurring investments are arranged with your Wolf Forge team.";
    case "unpriced":
      return "This investment is priced with your Wolf Forge team.";
    case "membership_inactive":
      return "Purchasing with your Wolf Forge Balance needs an active WF Card membership.";
    case "insufficient_balance":
      return "Your Wolf Forge Balance does not cover this yet.";
    case "balance_unknown":
      return "Your Wolf Forge Balance is unavailable right now.";
  }
}
