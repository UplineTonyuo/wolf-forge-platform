import type { PaymentRailStatus } from "./payment-rails";

/**
 * How one invoice gets paid: balance first, then the rest.
 *
 * THE SETTLED RULE. When an invoice exceeds the available Wolf Forge Balance,
 * the balance is applied **first** and the remainder is due through an external
 * rail. $780 invoice against a $500 balance is $500 + $280, never "$780
 * externally" and never "insufficient, pay another way".
 *
 * This module computes that split and nothing else. It moves no money, and it
 * is deliberately pure so the arithmetic can be proven without a database.
 *
 * WHAT IT DOES NOT CLAIM. `app_pay_invoice_with_wallet` takes no amount: it
 * derives the debit from the invoice, refuses when the wallet cannot cover it
 * in full, and is the only audited settlement path that exists. So a *partial*
 * wallet debit is not executable today, and neither PayPal nor bank transfer is
 * connected to collect a remainder. `executableNow` reports that honestly, and
 * every surface reads it rather than assuming a plan can be carried out. A plan
 * is what is owed and how it would be split — not a promise that a button
 * exists for it.
 */

export type WalletApplicationBlocker =
  /** WF Card membership is not active — the gate the RPC itself enforces. */
  | "membership_required"
  /** The wallet holds a different currency; the RPC raises on this. */
  | "currency_mismatch"
  /** Nothing in the wallet to apply. */
  | "empty_balance";

export type SettlementBlocker =
  /** The invoice is not open for payment at all. */
  | "not_collectible"
  /**
   * The balance covers it, but the wallet itself cannot be used.
   * Carries the wallet's own reason.
   */
  | WalletApplicationBlocker
  /**
   * The remainder needs an external rail and Wolf Forge has connected none.
   * This is the $780/$500 case today.
   */
  | "external_rail_unavailable"
  /**
   * The remainder needs an external rail and at least one is connected, so the
   * client completes the payment there. Not a fault — the next step.
   */
  | "external_payment_required";

export type InvoiceSettlementPlan = {
  currency: string;
  /** What the invoice still owes, straight from the financials RPC. */
  invoiceDueCents: number;
  /** The wallet's real balance. Shown even when it cannot be applied. */
  walletBalanceCents: number;
  /** Balance-first: min(applicable balance, amount due). Never negative. */
  walletAppliedCents: number;
  /** What an external rail would have to collect. Never negative. */
  remainingCents: number;
  /** True when the wallet alone clears the invoice. */
  fullyCoveredByWallet: boolean;
  /** True when the plan is a genuine split: some wallet, some external. */
  isSplit: boolean;
  /** Why the wallet contributes nothing, or null when it contributes. */
  walletBlocker: WalletApplicationBlocker | null;
  /**
   * True only when this exact plan can be carried out right now, end to end.
   * Today that means: collectible, wallet usable, and the wallet covers the
   * whole amount — because the RPC is all-or-nothing and no external rail is
   * connected.
   */
  executableNow: boolean;
  /** Why not, or null when it is executable. */
  blocker: SettlementBlocker | null;
};

export type InvoiceSettlementInput = {
  invoiceDueCents: number;
  currency: string;
  walletBalanceCents: number;
  walletCurrency: string;
  membershipStatus: "inactive" | "pending" | "active" | "cancelled";
  /** The database's answer on whether this invoice is open for payment. */
  collectible: boolean;
  /** Availability of the external rails, from server configuration. */
  externalRailStatuses: readonly PaymentRailStatus[];
};

function walletBlockerFor(input: InvoiceSettlementInput): WalletApplicationBlocker | null {
  /*
   * Order matters: membership is checked before currency and before the amount,
   * because it is the first thing the RPC checks and it is the one a client can
   * act on. Reporting "empty balance" to someone who has $500 but no membership
   * would send them to fix the wrong thing.
   */
  if (input.membershipStatus !== "active") return "membership_required";
  if (input.walletCurrency.toUpperCase() !== input.currency.toUpperCase()) {
    return "currency_mismatch";
  }
  if (input.walletBalanceCents <= 0) return "empty_balance";
  return null;
}

export function composeInvoiceSettlementPlan(
  input: InvoiceSettlementInput,
): InvoiceSettlementPlan {
  // Clamped rather than trusted. A negative due or balance is a data fault, and
  // it must not turn into a negative "remaining" a client is asked to pay.
  const due = Math.max(0, Math.trunc(input.invoiceDueCents));
  const balance = Math.max(0, Math.trunc(input.walletBalanceCents));

  const walletBlocker = walletBlockerFor({ ...input, walletBalanceCents: balance });

  /*
   * Balance first. The three settled cases fall out of one expression:
   *   balance >= due  → applied = due,     remaining = 0
   *   0 < balance < due → applied = balance, remaining = due - balance
   *   balance = 0 (or unusable) → applied = 0, remaining = due
   */
  const applied = walletBlocker === null ? Math.min(balance, due) : 0;
  const remaining = due - applied;

  const fullyCoveredByWallet = due > 0 && remaining === 0;
  const isSplit = applied > 0 && remaining > 0;

  const externalAvailable = input.externalRailStatuses.some(
    (status) => status === "available",
  );

  const blocker: SettlementBlocker | null = !input.collectible || due === 0
    ? "not_collectible"
    : fullyCoveredByWallet
      ? null
      : /*
         * Something must be collected externally. If the wallet contributed
         * nothing, the wallet's own reason is the more useful one to report —
         * a client with an inactive membership needs to hear that, not
         * "PayPal is not connected".
         */
        walletBlocker !== null && applied === 0
        ? walletBlocker
        : externalAvailable
          ? "external_payment_required"
          : "external_rail_unavailable";

  return {
    currency: input.currency,
    invoiceDueCents: due,
    walletBalanceCents: balance,
    walletAppliedCents: applied,
    remainingCents: remaining,
    fullyCoveredByWallet,
    isSplit,
    walletBlocker,
    /*
     * Deliberately narrow. The only settlement the platform can complete today
     * is a full wallet payment on a collectible invoice; everything else is a
     * plan awaiting a connected rail. Widening this without a rail that can
     * actually collect would be the fake completion this must not introduce.
     */
    executableNow: input.collectible && due > 0 && fullyCoveredByWallet,
    blocker,
  };
}
