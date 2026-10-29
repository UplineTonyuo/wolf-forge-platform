import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserSupabaseClient, verifyActor, assertVerifiedActor } from "../lib/supabase/user-client";
import type { TenantSelector } from "../domain/tenancy/tenant-selector";
const mock = vi.hoisted(() => ({ claims: vi.fn(), rpc: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => {
  mock.create(...args); return { auth: { getClaims: mock.claims }, rpc: mock.rpc };
} }));
const owner = "b1740000-0000-4000-8000-000000000001";
const target = "b1740000-0000-4000-8000-000000000002";
const tenant = "b1740000-0000-4000-8000-000000000010" as TenantSelector;
const id = "b1740000-0000-4000-8000-000000000090";
const token = `${id}.${"a".repeat(64)}`;
const proof = () => ({ id, administratorId: owner, clientId: target, tenantId: tenant,
  companyId: "b1740000-0000-4000-8000-000000000020", email: "client@example.invalid", displayName: "Synthetic client",
  companyName: "Synthetic company", expiresAt: new Date(Date.now() + 600000).toISOString() });
const make = (support = token) => createUserSupabaseClient({ SUPABASE_URL: "https://provider.example.invalid", SUPABASE_PUBLISHABLE_KEY: "test-key" }, "original-token", tenant, support);
beforeEach(() => { vi.clearAllMocks(); mock.claims.mockResolvedValue({ data: { claims: { sub: owner, email: "owner@example.invalid" } }, error: null }); mock.rpc.mockResolvedValue({ data: proof(), error: null }); });
describe("verified delegated actor", () => {
  it("retains the signed original bearer and requires a server support proof", async () => {
    const actor = await verifyActor(make());
    expect(actor.id).toBe(target); expect(actor.email).toBe("client@example.invalid");
    expect(actor.support?.administratorId).toBe(owner); expect(() => assertVerifiedActor(actor)).not.toThrow();
    expect(mock.claims).toHaveBeenCalledWith("original-token");
    expect(mock.claims.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[0]!);
    expect(mock.create.mock.calls[0]?.[2].global.headers.Authorization).toBe("Bearer original-token");
  });
  it.each([
    { administratorId: target }, { tenantId: target }, { id: target }, { expiresAt: new Date(0).toISOString() },
  ])("rejects mismatched or expired proof %j", async (override) => {
    mock.rpc.mockResolvedValue({ data: { ...proof(), ...override }, error: null });
    await expect(verifyActor(make())).rejects.toThrow();
  });
  it("fails closed when the hook is missing and proof is unavailable", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(verifyActor(make())).rejects.toThrow();
  });
  it("does not request a target proof for an invalid original identity", async () => {
    mock.claims.mockResolvedValue({ data: { claims: {} }, error: null });
    await expect(verifyActor(make())).rejects.toThrow(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("preserves normal session actor semantics without support", async () => {
    const actor = await verifyActor(createUserSupabaseClient({ SUPABASE_URL: "https://provider.example.invalid", SUPABASE_PUBLISHABLE_KEY: "test-key" }, "original-token", tenant));
    expect(actor.id).toBe(owner); expect(actor.support).toBeUndefined(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unverified forged actor", () => { expect(() => assertVerifiedActor({ id: target } as never)).toThrow(); });
});
