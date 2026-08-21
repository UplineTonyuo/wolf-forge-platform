import {
  ensureStripeCustomerSchema,
  stripeCustomerIdSchema,
  stripeCustomerIdempotencyKey,
  toStripeCustomerProfile,
  type EnsureStripeCustomerResult,
  type StripeCustomerId,
  type StripeCustomerProfile,
} from "../domain/billing/stripe-customer";
import { parseInput } from "../domain/shared";
import type { BillingRepository } from "../repositories/billing-repository";
import { requireVerifiedActor, type UserMutationActor } from "./mutation-context";

/**
 * The Stripe capability this service needs, and nothing more.
 *
 * A port rather than the Stripe SDK type: it keeps the service testable without
 * a key or a network, and it means the only Stripe surface the rest of the
 * platform can reach is "create a customer". The concrete adapter is built at
 * the action boundary, where `server-only` applies.
 */
export type StripeCustomerGateway = {
  createCustomer(
    profile: StripeCustomerProfile,
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
};

export type BillingServiceDependencies = {
  repository: BillingRepository;
  stripe: StripeCustomerGateway;
};

/**
 * Billing identity orchestration — Phase 1.
 *
 * Establishes the company ↔ Stripe Customer mapping and nothing else. There is
 * no charge, no saved card, no subscription and no webhook here. Wolf Forge
 * remains the source of truth for every invoice, plan, cycle and status; Stripe
 * holds an identity that later phases will collect against.
 */
export class BillingService {
  constructor(private readonly dependencies: BillingServiceDependencies) {}

  /**
   * Guarantees the company has exactly one canonical Stripe Customer.
   *
   * Idempotent by three separate mechanisms, because a duplicate customer is
   * the one mistake in this phase that is genuinely painful to undo:
   *
   *   1. It returns early when a mapping already exists, so the normal repeat
   *      call never reaches Stripe at all.
   *   2. Provisioning carries a company-derived Stripe idempotency key, so two
   *      callers racing past step 1 are handed the *same* customer by Stripe.
   *   3. The write is a compare-and-set in the database, so the stored mapping
   *      is whichever landed first and is never replaced.
   *
   * Authorization is not decided here. The caller supplies a verified actor and
   * a session-scoped repository; `app_link_company_stripe_customer` re-checks
   * for an internal actor holding `invoices.manage`, and RLS decides which
   * company rows the read can see at all.
   */
  async ensureStripeCustomer(
    input: unknown,
    actor: UserMutationActor,
  ): Promise<EnsureStripeCustomerResult> {
    requireVerifiedActor(actor);
    const { companyId } = parseInput(ensureStripeCustomerSchema, input);

    const identity = await this.dependencies.repository.getBillingIdentity(companyId);

    if (identity.stripeCustomerId) {
      return {
        companyId: identity.id,
        stripeCustomerId: identity.stripeCustomerId,
        created: false,
      };
    }

    const billingEmail = await this.dependencies.repository.getPrimaryContactEmail(companyId);

    const customer = await this.dependencies.stripe.createCustomer(
      toStripeCustomerProfile({
        id: identity.id,
        name: identity.name,
        billingEmail,
      }),
      { idempotencyKey: stripeCustomerIdempotencyKey(companyId) },
    );

    /*
     * Validated before it is stored. The id comes from Stripe rather than from a
     * browser, but the shape is still checked here so a malformed or stubbed
     * value cannot reach the database — the CHECK constraint would refuse it
     * anyway, and this turns that into a clear error rather than a 23514.
     */
    const provisioned = parseInput(stripeCustomerIdSchema, customer.id) as StripeCustomerId;

    const canonical = await this.dependencies.repository.linkStripeCustomer(
      companyId,
      provisioned,
    );

    return {
      companyId: identity.id,
      stripeCustomerId: canonical,
      /*
       * False when a concurrent caller won the race: this call created a Stripe
       * customer, but it is not the company's canonical one, so reporting it as
       * created would misdescribe the mapping.
       */
      created: canonical === provisioned,
    };
  }

  /** Reads the mapping without provisioning. Used by later phases and by tests. */
  async getStripeCustomerId(companyId: unknown): Promise<StripeCustomerId | null> {
    const { companyId: id } = parseInput(ensureStripeCustomerSchema, { companyId });
    const identity = await this.dependencies.repository.getBillingIdentity(id);
    return identity.stripeCustomerId;
  }
}
