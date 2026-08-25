import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_PROVIDER_IDS,
  INTEGRATION_PROVIDER_REGISTRY,
  INTEGRATION_PROVIDERS,
} from "../domain/integrations/registry";
import {
  toIntegrationConnectionViews,
  type IntegrationConnectionRow,
} from "../domain/integrations/schema";
import { IntegrationService } from "../services/integration-service";

const persistedStripe: IntegrationConnectionRow = {
  id: "connection-stripe",
  provider: "stripe",
  status: "connected",
  connected_account_id: "acct_ignored_by_client_projection",
  connected_account_display: "Wolf Forge · Merchant 4242",
  connected_by_profile_id: "profile-admin",
  connected_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:01:00.000Z",
  last_synced_at: null,
  expires_at: null,
  granted_scopes: ["payments:read"],
};

describe("integration provider registry", () => {
  it("registers Gmail, Stripe, and PayPal once in canonical order", () => {
    expect(INTEGRATION_PROVIDER_IDS).toEqual(["gmail", "stripe", "paypal"]);
    expect(INTEGRATION_PROVIDERS.map(({ name }) => name)).toEqual(["Gmail", "Stripe", "PayPal"]);
    expect(INTEGRATION_PROVIDERS.every((provider) => provider === INTEGRATION_PROVIDER_REGISTRY[provider.id])).toBe(true);
  });

  it.each(INTEGRATION_PROVIDER_IDS)("derives %s as disconnected when no row exists", (providerId) => {
    const connection = toIntegrationConnectionViews([]).find(({ provider }) => provider.id === providerId);
    expect(connection).toMatchObject({ status: "disconnected", connectionId: null });
  });

  it("derives Connected only from persisted connection metadata", async () => {
    const service = new IntegrationService({ repository: { listConnections: async () => [persistedStripe] } });
    const connections = await service.listConnections();
    expect(connections.find(({ provider }) => provider.id === "stripe")).toMatchObject({
      status: "connected",
      connectionId: "connection-stripe",
      connectedAccountDisplay: "Wolf Forge · Merchant 4242",
    });
    expect(connections.find(({ provider }) => provider.id === "gmail")?.status).toBe("disconnected");
  });

  it("never projects credential or raw metadata fields to Client Component props", () => {
    const [connection] = toIntegrationConnectionViews([persistedStripe]).filter(({ provider }) => provider.id === "stripe");
    const serialized = JSON.stringify(connection);
    expect(serialized).not.toMatch(/access.?token|refresh.?token|client.?secret|webhook.?secret|private.?key|provider_metadata/i);
    expect(Object.keys(connection ?? {})).not.toContain("connectedAccountId");
  });

  it("keeps the migration metadata-only and browser writes closed", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260825005219_settings_integrations_foundation.sql"),
      "utf8",
    );
    expect(migration).toContain("'integrations.manage'");
    expect(migration).toMatch(/revoke all on table public\.integration_connections[\s\S]+authenticated/i);
    expect(migration).not.toMatch(/create or replace function public\.app_(connect|set|upsert)_integration/i);
    expect(migration).not.toMatch(/access_token\s+(text|jsonb)|refresh_token\s+(text|jsonb)|client_secret\s+(text|jsonb)/i);
  });
});
