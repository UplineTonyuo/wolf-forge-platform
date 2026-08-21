import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  stripeCustomerIdSchema,
  stripeCustomerIdempotencyKey,
  toStripeCustomerProfile,
} from "../domain/billing/stripe-customer";
import { isStripeConfigured, readStripeEnvironment } from "../lib/env/stripe-env";
import type { BillingRepository } from "../repositories/billing-repository";
import { BillingService, type StripeCustomerGateway } from "../services/billing-service";
import { createUserSupabaseClient, verifyActor } from "../lib/supabase/user-client";

/**
 * Stripe Phase 1: the company ↔ Stripe Customer mapping.
 *
 * Stripe is stubbed throughout. Nothing in this file may reach a real Stripe
 * account, so the gateway is a local double and no key is ever read.
 */

const COMPANY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_COMPANY_ID = "0b3f2c1a-2f4b-4a1e-9c7d-8e1f2a3b4c5d";

/**
 * A genuinely branded actor.
 *
 * Built through the real `createUserSupabaseClient` so the access token is
 * registered where `verifyActor` looks for it, with only the claims call
 * stubbed. A hand-rolled object cannot work here by design — `assertVerifiedActor`
 * rejects anything the factory did not produce — and weakening that to suit a
 * test would defeat the boundary it exists to protect.
 */
async function testActor() {
  const client = createUserSupabaseClient(
    { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "test-key" },
    "test-access-token",
  );

  client.auth.getClaims = (async () => ({
    data: { claims: { sub: "11111111-1111-4111-8111-111111111111" } },
    error: null,
  })) as unknown as typeof client.auth.getClaims;

  return verifyActor(client);
}

type RepoState = {
  stripeCustomerId: string | null;
  email?: string | null;
  /** Simulates a concurrent winner: what the compare-and-set returns. */
  linkReturns?: string;
};

function fakeRepository(state: RepoState) {
  const linkStripeCustomer = vi.fn(async (_companyId: string, id: string) => {
    if (state.linkReturns) return state.linkReturns;
    state.stripeCustomerId = id;
    return id;
  });

  const repository = {
    getBillingIdentity: vi.fn(async (companyId: string) => {
      if (companyId !== COMPANY_ID) {
        // Stands in for RLS returning nothing for another company's row.
        throw new Error("Company was not found.");
      }
      return { id: COMPANY_ID, name: "Northgate Dental", stripeCustomerId: state.stripeCustomerId };
    }),
    getPrimaryContactEmail: vi.fn(async () => state.email ?? null),
    linkStripeCustomer,
  };

  return repository as unknown as BillingRepository & typeof repository;
}

function fakeStripe(id = "cus_TestCustomer123") {
  const createCustomer = vi.fn(async () => ({ id }));
  return { gateway: { createCustomer } as StripeCustomerGateway, createCustomer };
}

describe("stripe customer id contract", () => {
  it("accepts a Stripe customer reference", () => {
    expect(stripeCustomerIdSchema.parse("cus_QxYz123")).toBe("cus_QxYz123");
  });

  it("refuses anything that is not one", () => {
    for (const value of [
      "sk_test_abc123",
      "pk_test_abc123",
      "price_123",
      "cus_",
      "customer_123",
      "",
      "'; drop table companies; --",
    ]) {
      expect(stripeCustomerIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it("derives one stable idempotency key per company", () => {
    expect(stripeCustomerIdempotencyKey(COMPANY_ID)).toBe(
      `wf-company-customer-${COMPANY_ID}`,
    );
    expect(stripeCustomerIdempotencyKey(COMPANY_ID)).toBe(
      stripeCustomerIdempotencyKey(COMPANY_ID),
    );
    expect(stripeCustomerIdempotencyKey(OTHER_COMPANY_ID)).not.toBe(
      stripeCustomerIdempotencyKey(COMPANY_ID),
    );
  });
});

describe("stripe customer profile", () => {
  it("sends the company name and the Wolf Forge company id", () => {
    expect(toStripeCustomerProfile({ id: COMPANY_ID, name: "Northgate Dental" })).toEqual({
      name: "Northgate Dental",
      metadata: { wolf_forge_company_id: COMPANY_ID },
    });
  });

  it("includes a billing email only when one is on file", () => {
    expect(
      toStripeCustomerProfile({
        id: COMPANY_ID,
        name: "Northgate Dental",
        billingEmail: "billing@northgate.invalid",
      }).email,
    ).toBe("billing@northgate.invalid");

    expect(
      toStripeCustomerProfile({ id: COMPANY_ID, name: "Northgate Dental", billingEmail: null }),
    ).not.toHaveProperty("email");

    // Blank is an absence, not a value.
    expect(
      toStripeCustomerProfile({ id: COMPANY_ID, name: "Northgate Dental", billingEmail: "  " }),
    ).not.toHaveProperty("email");
  });

  it("carries no personal data beyond the billing email", () => {
    const profile = toStripeCustomerProfile({
      id: COMPANY_ID,
      name: "Northgate Dental",
      billingEmail: "billing@northgate.invalid",
    });

    expect(Object.keys(profile).sort()).toEqual(["email", "metadata", "name"]);
    expect(Object.keys(profile.metadata)).toEqual(["wolf_forge_company_id"]);
  });
});

describe("ensureStripeCustomer", () => {
  it("provisions a customer for a company that has none", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    const result = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, await testActor());

    expect(result).toEqual({
      companyId: COMPANY_ID,
      stripeCustomerId: "cus_TestCustomer123",
      created: true,
    });
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(repository.linkStripeCustomer).toHaveBeenCalledWith(
      COMPANY_ID,
      "cus_TestCustomer123",
    );
  });

  it("creates the customer under the company's idempotency key", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    await service.ensureStripeCustomer({ companyId: COMPANY_ID }, await testActor());

    expect(createCustomer).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: `wf-company-customer-${COMPANY_ID}`,
    });
  });

  it("returns the existing mapping without calling Stripe", async () => {
    const repository = fakeRepository({ stripeCustomerId: "cus_Existing999" });
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    const result = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, await testActor());

    expect(result).toEqual({
      companyId: COMPANY_ID,
      stripeCustomerId: "cus_Existing999",
      created: false,
    });
    // The point of the whole phase: a repeat call must not reach Stripe.
    expect(createCustomer).not.toHaveBeenCalled();
    expect(repository.linkStripeCustomer).not.toHaveBeenCalled();
  });

  it("does not create a second customer when called repeatedly", async () => {
    const state: RepoState = { stripeCustomerId: null };
    const repository = fakeRepository(state);
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });
    const actor = await testActor();

    const first = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, actor);
    const second = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, actor);
    const third = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, actor);

    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(second.stripeCustomerId).toBe(first.stripeCustomerId);
    expect(third.stripeCustomerId).toBe(first.stripeCustomerId);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
  });

  it("yields to the mapping a concurrent caller stored first", async () => {
    // The compare-and-set reports someone else's customer as canonical.
    const repository = fakeRepository({ stripeCustomerId: null, linkReturns: "cus_WinnerAAA" });
    const { gateway } = fakeStripe("cus_LoserBBB");
    const service = new BillingService({ repository, stripe: gateway });

    const result = await service.ensureStripeCustomer({ companyId: COMPANY_ID }, await testActor());

    expect(result.stripeCustomerId).toBe("cus_WinnerAAA");
    // It created a customer, but not the canonical one — saying otherwise would lie.
    expect(result.created).toBe(false);
  });

  it("refuses an unverified actor", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    await expect(
      service.ensureStripeCustomer({ companyId: COMPANY_ID }, { id: "forged" } as never),
    ).rejects.toThrow();

    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("refuses a company id that is not a uuid", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway, createCustomer } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    await expect(
      service.ensureStripeCustomer({ companyId: "not-a-uuid" }, await testActor()),
    ).rejects.toThrow();

    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("refuses to store an identifier Stripe did not shape correctly", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway } = fakeStripe("sk_live_leaked_key_shape");
    const service = new BillingService({ repository, stripe: gateway });

    await expect(
      service.ensureStripeCustomer({ companyId: COMPANY_ID }, await testActor()),
    ).rejects.toThrow();

    expect(repository.linkStripeCustomer).not.toHaveBeenCalled();
  });

  it("cannot reach another company's row", async () => {
    const repository = fakeRepository({ stripeCustomerId: null });
    const { gateway } = fakeStripe();
    const service = new BillingService({ repository, stripe: gateway });

    // The read is RLS-scoped; the service has no way to widen it.
    await expect(
      service.ensureStripeCustomer({ companyId: OTHER_COMPANY_ID }, await testActor()),
    ).rejects.toThrow();
  });
});

describe("stripe environment", () => {
  it("accepts a secret or restricted key", () => {
    expect(readStripeEnvironment({ STRIPE_SECRET_KEY: "sk_test_abc123" }).STRIPE_SECRET_KEY).toBe(
      "sk_test_abc123",
    );
    expect(readStripeEnvironment({ STRIPE_SECRET_KEY: "rk_test_abc123" }).STRIPE_SECRET_KEY).toBe(
      "rk_test_abc123",
    );
  });

  it("refuses a publishable key in the secret slot", () => {
    expect(isStripeConfigured({ STRIPE_SECRET_KEY: "pk_test_abc123" })).toBe(false);
  });

  it("reports missing configuration without throwing", () => {
    expect(isStripeConfigured({})).toBe(false);
  });

  it("names the variable but never its value when it throws", () => {
    try {
      readStripeEnvironment({ STRIPE_SECRET_KEY: "pk_live_SUPERSECRETVALUE" });
      throw new Error("expected a validation failure");
    } catch (error) {
      expect(JSON.stringify(error)).toContain("STRIPE_SECRET_KEY");
      expect(JSON.stringify(error)).not.toContain("SUPERSECRETVALUE");
    }
  });
});

/**
 * The secret must be unreachable from the browser. These read the source rather
 * than the runtime, because the guarantee is structural: a `NEXT_PUBLIC_` name
 * or a client component importing the SDK is what would break it.
 */
describe("stripe secret stays server-side", () => {
  const sourceRoot = resolve(process.cwd(), "src");

  function read(relative: string): string {
    return readFileSync(resolve(sourceRoot, relative), "utf8");
  }

  it("never names the key with a NEXT_PUBLIC_ prefix", () => {
    for (const file of [
      "lib/env/stripe-env.ts",
      "lib/stripe/stripe-client.ts",
      "lib/stripe/stripe-customer-gateway.ts",
      "services/billing-service.ts",
      "app/actions/billing.ts",
    ]) {
      expect(read(file)).not.toContain("NEXT_PUBLIC_STRIPE");
    }
  });

  it("keeps every module that touches the SDK behind server-only", () => {
    expect(read("lib/stripe/stripe-client.ts")).toContain('import "server-only"');
    expect(read("lib/stripe/stripe-customer-gateway.ts")).toContain('import "server-only"');
  });

  it("keeps the SDK out of the service and the domain", () => {
    // The service depends on a port, so no client component can pull Stripe in.
    expect(read("services/billing-service.ts")).not.toContain('from "stripe"');
    expect(read("domain/billing/stripe-customer.ts")).not.toContain('from "stripe"');
  });

  it("has no client component importing the Stripe modules", () => {
    const offenders: string[] = [];

    function walk(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);

        // The suite itself quotes these markers; walking it would match on that.
        if (entry.isDirectory()) {
          if (entry.name !== "tests") walk(path);
          continue;
        }

        if (!/\.tsx?$/u.test(entry.name)) continue;
        if (/\.(before-|bak|backup)/u.test(entry.name)) continue;

        const source = readFileSync(path, "utf8");
        const isClientComponent = source.trimStart().startsWith('"use client"');

        if (
          isClientComponent &&
          (source.includes("lib/stripe/") || source.includes('from "stripe"'))
        ) {
          offenders.push(path);
        }
      }
    }

    walk(sourceRoot);
    expect(offenders).toEqual([]);
  });
});
