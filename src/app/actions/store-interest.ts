"use server";

import { revalidatePath } from "next/cache";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

/**
 * Investment intent server actions.
 *
 * The client-facing one is telemetry, so it is built to be ignorable: it never
 * throws, never redirects and never revalidates. The cart it reports on is
 * browser state that has already changed, and a failure here must leave that
 * cart exactly as the client left it.
 */

export type RecordStoreInterestResult = {
  /** False when the signal did not reach the server. Never reported as success. */
  ok: boolean;
};

/**
 * Records that a client added or removed investments.
 *
 * Takes service ids only. The company is derived from the authenticated session
 * inside the database, so there is no company for this action to accept, check
 * or get wrong.
 */
export async function recordStoreInterestAction(input: {
  serviceIds: string[];
  inCart: boolean;
}): Promise<RecordStoreInterestResult> {
  try {
    const context = await getClientContext();
    await context.services.storeInterest.record(
      { serviceIds: input.serviceIds, inCart: input.inCart },
      context.actor,
    );
    return { ok: true };
  } catch {
    /*
     * Swallowed on purpose. This is a sales-intelligence side effect of a
     * local-first cart: the client took a browsing action that already
     * succeeded, and interrupting them with an error about a record they never
     * asked us to keep would be the wrong trade. The caller reports nothing to
     * the client, and the next add or remove of the same investment re-states
     * the correct state anyway.
     */
    return { ok: false };
  }
}

export type UpdateInvestmentIntentStatusResult =
  | { ok: true }
  | { ok: false; error: string };

/** Internal only. Re-authorized by the investment_intent module and RLS. */
export async function updateInvestmentIntentStatusAction(input: {
  intentId: string;
  status: string;
}): Promise<UpdateInvestmentIntentStatusResult> {
  try {
    const context = await getInternalContext();
    await context.services.investmentIntent.setStatus(
      { intentId: input.intentId, status: input.status },
      context.actor,
    );

    revalidatePath("/investment-intent");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}
