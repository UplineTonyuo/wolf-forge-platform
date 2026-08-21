import "server-only";

import { readBankTransferMode, type BankTransferMode } from "../env/payment-rail-env";
import type { EnvironmentSource } from "../env/public-env";

/**
 * Where bank transfer will plug in. Nothing here contacts a bank.
 *
 * The rail is modelled as one client-facing identity — "Bank Transfer" — with
 * two possible executions behind it, so choosing between them later does not
 * change what the client picks, what the selector shows, or what any stored
 * preference would mean:
 *
 *   manual    Wolf Forge publishes transfer instructions and reconciles the
 *             incoming payment by hand. This is what William means today.
 *   provider  an automated bank/payment provider executes the transfer.
 *             Deliberately unnamed: nothing in this repository assumes ACH,
 *             Plaid, SEPA, Faster Payments, open banking or any vendor's API.
 *
 * THIS REPOSITORY HOLDS NO BANK DETAILS AND INVENTS NONE. There is no account
 * number, IBAN, routing number, sort code, SWIFT/BIC or beneficiary name
 * anywhere in this file, in `ClientPaymentRail`, or on any portal surface. When
 * the manual mode is switched on, the instructions must come from a real
 * operator-entered source — a settings row or a document Wolf Forge controls —
 * and must reach the client through a field added deliberately at that point,
 * not by widening a rail's `detail`.
 *
 * Whoever implements the manual mode: treat those details as data a client may
 * read, never as data a client may write. The rail's availability is a server
 * fact and a browser cannot change it.
 */
export type BankTransferRail = {
  /** Null until an operator declares one. Null on every environment today. */
  mode: BankTransferMode | null;
  configured: boolean;
};

export function readBankTransferRail(
  source: EnvironmentSource = process.env,
): BankTransferRail {
  const mode = readBankTransferMode(source);
  return { mode, configured: mode !== null };
}
