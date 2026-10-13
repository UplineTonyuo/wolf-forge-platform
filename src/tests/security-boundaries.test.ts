import { describe, expect, it, vi } from "vitest";
import { assertLocalSupabaseUrl, readPublicEnvironment } from "../lib/env/public-env";
import { createTrustedServerSupabaseClient, type TrustedServerClient } from "../lib/supabase/trusted-server-client";
import { assertVerifiedActor, createUserSupabaseClient, verifyActor, type UserScopedClient, type VerifiedActor } from "../lib/supabase/user-client";
import { CompanyRepository } from "../repositories/company-repository";
import { SystemActivityRepository } from "../repositories/activity-repository";

const environment = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "local-key" };

describe("verified actor and environment boundaries", () => {
  it("rejects actor derivation when Auth cannot verify a user", async () => {
    const client = createUserSupabaseClient(environment, "invalid-token");
    vi.spyOn(client.auth, "getClaims").mockResolvedValue({ data: null, error: new Error("invalid") } as never);
    await expect(verifyActor(client)).rejects.toMatchObject({ kind: "unavailable", stage: "claims" });
  });

  it.each(["invalid_jwt", "session_not_found"])("rejects %s as unauthenticated without retry", async (code) => {
    const client = createUserSupabaseClient(environment, "invalid-token");
    const claims = vi.spyOn(client.auth, "getClaims").mockResolvedValue({
      data: null, error: { code, status: code === "invalid_jwt" ? 400 : 401 },
    } as never);
    await expect(verifyActor(client)).rejects.toMatchObject({ kind: "unauthenticated", stage: "claims" });
    expect(claims).toHaveBeenCalledTimes(1);
  });

  it("recovers a claims verifier outage only after successful verification", async () => {
    const client = createUserSupabaseClient(environment, "signed-token");
    const claims = vi.spyOn(client.auth, "getClaims")
      .mockResolvedValueOnce({ data: null, error: { status: 503 } } as never)
      .mockResolvedValueOnce({ data: { claims: { sub: "20000000-0000-4000-8000-000000000001" } }, error: null } as never);
    const actor = await verifyActor(client);
    expect(claims).toHaveBeenCalledTimes(2);
    expect(() => assertVerifiedActor(actor)).not.toThrow();
  });

  it("derives and freezes actor identity only from verified Auth output", async () => {
    const client = createUserSupabaseClient(environment, "signed-token");
    vi.spyOn(client.auth, "getClaims").mockResolvedValue({ data: { claims: { sub: "20000000-0000-4000-8000-000000000001" } }, error: null } as never);
    const actor = await verifyActor(client);
    expect(actor.id).toBe("20000000-0000-4000-8000-000000000001");
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => assertVerifiedActor(actor)).not.toThrow();
    expect(() => assertVerifiedActor({ id: actor.id } as VerifiedActor)).toThrow("server-verified actor");
  });

  it("rejects missing environment values and remote local-workflow URLs", () => {
    expect(() => readPublicEnvironment({})).toThrow();
    expect(() => assertLocalSupabaseUrl("https://project.supabase.co")).toThrow("local Supabase URL");
    expect(() => assertLocalSupabaseUrl("http://127.0.0.1:54321")).not.toThrow();
  });
});

// Compile-time regression locks: neither actor nor client trust can be forged
// through ordinary structural assignment.
const userClient = null as unknown as UserScopedClient;
const trustedClient = null as unknown as TrustedServerClient;
new CompanyRepository(userClient);
new SystemActivityRepository(trustedClient);
// @ts-expect-error trusted clients cannot wire normal operational repositories
new CompanyRepository(trustedClient);
// @ts-expect-error user clients cannot gain server-only system activity capability
new SystemActivityRepository(userClient);
// @ts-expect-error a request-supplied object is not a verified actor
const forgedActor: VerifiedActor = { id: "20000000-0000-4000-8000-000000000001" };
void forgedActor;
void createTrustedServerSupabaseClient;
