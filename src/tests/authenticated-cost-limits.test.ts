import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("authenticated high-cost application boundaries", () => {
  const limiter = read("lib/security/server-cost-limit.ts");
  const migration = read("../supabase/migrations/20260827100220_authenticated_cost_limits.sql");

  it("uses one durable service-only limiter rather than process memory", () => {
    expect(limiter).toContain('rpc("app_consume_server_cost_limit"');
    expect(limiter).not.toContain("new Map(");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("covers the selected search, provider, provisioning and fan-out scopes", () => {
    for (const scope of [
      "search.global",
      "search.client",
      "report.send",
      "integration.gmail.verify",
      "account.provision",
      "billing.stripe_customer",
    ]) {
      expect(migration).toContain(`when '${scope}'`);
    }
  });

  it("enforces limits before each expensive call", () => {
    const boundaries: Array<[string, string]> = [
      ["app/actions/global-search.ts", ".from("],
      ["app/actions/client-search.ts", "Promise.all("],
      ["app/actions/reporting.ts", "context.services.reporting.send("],
      ["app/actions/billing.ts", "billing.ensureStripeCustomer("],
      ["app/actions/client-account-provisioning.ts", "provisioning.provisionClientAccount("],
      ["app/actions/member-account-provisioning.ts", "provisioning.provisionInternalMember("],
      ["app/(internal)/settings/integrations/gmail/verify/route.ts", ".verify()"],
    ];

    for (const [path, expensiveCall] of boundaries) {
      const source = read(path);
      const limiterIndex = source.indexOf("enforceServerCostLimit({");
      expect(limiterIndex, path).toBeGreaterThan(-1);
      expect(source.indexOf(expensiveCall, limiterIndex), path).toBeGreaterThan(limiterIndex);
    }
  });

  it("returns HTTP 429 on the provider-backed route", () => {
    const verifyRoute = read("app/(internal)/settings/integrations/gmail/verify/route.ts");
    expect(verifyRoute).toContain("? 429 : 503");
  });
});
