import type { StripeCustomerId } from "../domain/billing/stripe-customer";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

/**
 * Billing identity storage.
 *
 * Database work only. This class never calls Stripe — the HTTP boundary lives
 * in the service, so the repository stays the single Supabase caller and can be
 * exercised without a network or an API key.
 */
export class BillingRepository {
  constructor(private readonly client: UserMutationClient) {}

  /**
   * The company's billing identity, as far as Wolf Forge knows it.
   *
   * A plain select, so RLS decides visibility: internal sessions read any
   * company, a client session reads only its own, and an unauthorised caller
   * gets nothing rather than a filtered answer from application code.
   */
  async getBillingIdentity(companyId: string): Promise<{
    id: string;
    name: string;
    stripeCustomerId: StripeCustomerId | null;
  }> {
    const result = await this.client
      .from("companies")
      .select("id, name, stripe_customer_id")
      .eq("id", companyId)
      .is("archived_at", null)
      .single();

    if (result.error) throw mapDatabaseError(result.error, "Company");

    return {
      id: result.data.id,
      name: result.data.name,
      stripeCustomerId: result.data.stripe_customer_id as StripeCustomerId | null,
    };
  }

  /**
   * The email a Stripe customer should carry, if Wolf Forge has one.
   *
   * The primary, non-archived client contact. Staff-entered rather than
   * verified, so it is treated as a convenience for billing correspondence, not
   * as an identity. Returns null rather than guessing when no primary contact
   * has an address recorded.
   */
  async getPrimaryContactEmail(companyId: string): Promise<string | null> {
    const result = await this.client
      .from("client_contacts")
      .select("email")
      .eq("company_id", companyId)
      .eq("is_primary", true)
      .is("archived_at", null)
      .not("email", "is", null)
      .limit(1);

    if (result.error) throw mapDatabaseError(result.error, "Client contact");
    return result.data[0]?.email ?? null;
  }

  /**
   * Claims the company's canonical Stripe customer, once.
   *
   * Returns whatever the database considers canonical: the value just written,
   * or the one a concurrent caller wrote first. The RPC never replaces an
   * existing mapping, so this can be called safely without checking first.
   */
  async linkStripeCustomer(
    companyId: string,
    stripeCustomerId: StripeCustomerId,
  ): Promise<StripeCustomerId> {
    return unwrapOne(
      await this.client.rpc("app_link_company_stripe_customer", {
        p_company_id: companyId,
        p_stripe_customer_id: stripeCustomerId,
      }),
      "Stripe customer link",
    ) as StripeCustomerId;
  }
}
