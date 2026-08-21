import { z } from "zod";
import { uuidSchema } from "../shared";

/**
 * The Wolf Forge company ↔ Stripe Customer mapping, as pure rules.
 *
 * Wolf Forge stays the billing source of truth. A Stripe Customer is only an
 * identity in William's Stripe account that later phases can charge against; it
 * owns no price, no plan and no invoice.
 */

/**
 * Stripe customer references look like `cus_…`.
 *
 * Mirrors the database CHECK constraint exactly, so a bad value is rejected
 * before a round trip as well as at the table.
 */
export const stripeCustomerIdSchema = z
  .string()
  .trim()
  .regex(/^cus_[A-Za-z0-9]+$/u, "Enter a valid Stripe customer id.");

export type StripeCustomerId = z.infer<typeof stripeCustomerIdSchema>;

export const ensureStripeCustomerSchema = z.object({ companyId: uuidSchema });

export type EnsureStripeCustomerInput = z.infer<typeof ensureStripeCustomerSchema>;

/**
 * The outcome of ensuring a mapping.
 *
 * `created` distinguishes "we provisioned one" from "one already existed",
 * which is what makes the operation observably idempotent to a caller and to a
 * test without exposing anything about Stripe's internals.
 */
export type EnsureStripeCustomerResult = {
  companyId: string;
  stripeCustomerId: StripeCustomerId;
  created: boolean;
};

/**
 * The Stripe idempotency key for provisioning a company's customer.
 *
 * Derived from the company id and nothing else, so two requests racing to
 * provision the same company are handed the *same* Stripe customer rather than
 * two competing ones. This is the first of the two concurrency guards; the
 * second is the compare-and-set in app_link_company_stripe_customer.
 *
 * Stripe expires idempotency keys after roughly 24 hours. That is harmless
 * here: once the mapping is stored the service short-circuits before ever
 * reaching Stripe, so the key only has to hold for the length of a race.
 */
export function stripeCustomerIdempotencyKey(companyId: string): string {
  return `wf-company-customer-${companyId}`;
}

/**
 * What Wolf Forge tells Stripe about a company.
 *
 * Deliberately minimal. The name is the company's own, the email is the primary
 * contact's when one has been recorded, and the only metadata is the Wolf Forge
 * company id — which is what lets a webhook in a later phase resolve a Stripe
 * object back to a company without trusting anything a browser sent.
 *
 * Nothing else belongs here: no addresses, no phone numbers, no contact names,
 * no internal status. Stripe is a payment processor, not a second CRM, and
 * every extra field is personal data copied into a system that does not need
 * it.
 */
export type StripeCustomerProfile = {
  name: string;
  email?: string;
  metadata: { wolf_forge_company_id: string };
};

export function toStripeCustomerProfile(company: {
  id: string;
  name: string;
  billingEmail?: string | null;
}): StripeCustomerProfile {
  const email = company.billingEmail?.trim();

  return {
    name: company.name,
    /*
     * Omitted rather than sent empty when no contact email is on file. Stripe
     * treats an absent field and a blank one differently, and inventing a
     * placeholder would be inventing information.
     */
    ...(email ? { email } : {}),
    metadata: { wolf_forge_company_id: company.id },
  };
}
