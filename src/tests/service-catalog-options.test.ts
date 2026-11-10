import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceRepository } from "../repositories/service-repository";
import { CatalogService } from "../services/catalog-service";
import { getInternalContext } from "../lib/supabase/next-server";

const contexts = vi.hoisted(() => ({ clients: [] as unknown[] }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-wf-tenant": "f0f0f0f0-0000-4000-8000-000000000001" }),
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { access_token: "synthetic-session" } }, error: null }),
} }) }));
vi.mock("../lib/supabase/user-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/supabase/user-client")>(),
  createUserSupabaseClient: () => contexts.clients.shift(),
  verifyActor: async () => ({ id: "20000000-0000-4000-8000-000000000001" }),
}));

afterEach(() => { vi.unstubAllEnvs(); contexts.clients = []; });

function fixture() {
  const rows = [{ id: "service", name: "Synthetic service", folder_id: null, description: "Full description" }];
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  const repository = new ServiceRepository({ from: vi.fn().mockReturnValue(query) } as never);
  return { rows, query, repository, catalog: new CatalogService({ repository }) };
}

describe("internal service option projections", () => {
  it("wires one raw assignee read per verified internal context without sharing across requests", async () => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-nonsecret-key");
    const member = "20000000-0000-4000-8000-000000000001";
    function contextClient(displayName: string) {
      const order = { id: "10000000-0000-4000-8000-000000000001", assigned_to_profile_id: member, companies: null, services: null };
      const rpc = vi.fn(async (name: string) => {
        switch (name) {
          case "app_current_tenant_membership": return { data: [{ account_class: "internal", role_name: "staff", tenant_id: "f0f0f0f0-0000-4000-8000-000000000001" }], error: null };
          case "app_current_user_permissions": case "app_current_user_modules": case "app_list_order_response_states": return { data: [], error: null };
          case "app_list_operational_assignees": return { data: [{ profile_id: member, display_name: displayName, avatar_url: null }], error: null };
          default: throw new Error(`Unexpected RPC ${name}`);
        }
      });
      const orders = { select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: async () => ({ data: [order], count: 1, error: null }) };
      return { rpc, from: (table: string) => {
        if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: member, display_name: "Synthetic staff", archived_at: null }, error: null }) }) }) };
        if (table === "orders") return orders;
        if (table === "order_tasks") return { select: () => ({ in: () => ({ is: async () => ({ data: [], error: null }) }) }) };
        throw new Error(`Unexpected table ${table}`);
      } };
    }
    const first = contextClient("First request");
    const second = contextClient("Second request");
    contexts.clients.push(first, second);
    for (const [client, name] of [[first, "First request"], [second, "Second request"]] as const) {
      const context = await getInternalContext();
      const [people, projects] = await Promise.all([context.services.catalog.listAssignees(), context.services.orders.listProjects()]);
      expect(people[0]?.displayName).toBe(name);
      expect(projects.rows[0]?.assigneeName).toBe(name);
      expect(client.rpc.mock.calls.filter(([rpc]) => rpc === "app_list_operational_assignees")).toHaveLength(1);
    }
  });
  it("loads only option fields for active Orders filters with the existing predicates and order", async () => {
    const { query, catalog, rows } = fixture();
    expect(await catalog.listActiveOptions()).toEqual(rows);
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id, name, folder_id");
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("is_active", true);
    expect(query.is).toHaveBeenCalledExactlyOnceWith("archived_at", null);
    expect(query.order.mock.calls).toEqual([["name"]]);
  });

  it("keeps inactive catalog entries and catalog ordering for Dashboard icons", async () => {
    const { query, catalog, rows } = fixture();
    expect(await catalog.listCatalogOptions()).toEqual(rows);
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id, name, folder_id");
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.is).toHaveBeenCalledExactlyOnceWith("archived_at", null);
    expect(query.order.mock.calls).toEqual([["sort_order"], ["name"]]);
  });

  it.each(["listActive", "listCatalog"] as const)("preserves the full-row %s contract for unrelated callers", async (method) => {
    const { query, catalog } = fixture();
    const rows = await catalog[method]();
    expect(query.select).toHaveBeenCalledExactlyOnceWith();
    expect(rows[0]?.description).toBe("Full description");
  });
});
