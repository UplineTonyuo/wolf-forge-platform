"use server";

import { createStripeCustomerGateway } from "../../lib/stripe/stripe-customer-gateway";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { getInternalContext } from "../../lib/supabase/next-server";
import { BillingRepository } from "../../repositories/billing-repository";
import { BillingService } from "../../services/billing-service";

/**
 * Stripe billing identity — Phase 1.
 *
 * Infrastructure only. This provisions the company ↔ Stripe Customer mapping
 * and deliberately exposes nothing else: no charge, no saved card, no checkout,
 * no subscription. There is no UI behind it yet by design.
 *
 * Internal only. The action resolves an internal context, and the underlying
 * RPC independently re-checks for an internal actor holding `invoices.manage` —
 * so a company id arriving from a browser is a *request*, never an authority.
 */

export type EnsureStripeCustomerResult =
  | { ok: true; stripeCustomerId: string; created: boolean }
  | { ok: false; error: string };

export async function ensureCompanyStripeCustomerAction(input: {
  companyId: string;
}): Promise<EnsureStripeCustomerResult> {
  try {
    const context = await getInternalContext();

    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "billing.stripe_customer",
      organizationId: input.companyId,
    });

    const billing = new BillingService({
      /*
       * Session-scoped client, like every other repository here: the read is
       * subject to RLS and the write is subject to the RPC's capability check.
       * No service-role client is constructed on this path.
       */
      repository: new BillingRepository(context.client),
      stripe: createStripeCustomerGateway(),
    });

    const result = await billing.ensureStripeCustomer(
      { companyId: input.companyId },
      context.actor,
    );

    return {
      ok: true,
      stripeCustomerId: result.stripeCustomerId,
      created: result.created,
    };
  } catch (error) {
    /*
     * Mapped through the shared boundary so a Stripe or Postgres message never
     * reaches the browser verbatim — a raw Stripe error can name the account and
     * the request id.
     */
    return { ok: false, error: toClientSafeError(error).message };
  }
}
