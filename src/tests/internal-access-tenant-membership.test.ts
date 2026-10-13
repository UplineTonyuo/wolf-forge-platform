import { describe, expect, it } from "vitest";
import { resolveInternalUser } from "../lib/supabase/next-server";
import type { UserScopedClient, VerifiedActor } from "../lib/supabase/user-client";

/*
 * WL-2.18 (KI-115). The internal-app decision reads the caller's membership in
 * the CURRENT Tenant (app_current_tenant_membership, which resolves the Tenant
 * from the server-sent selector and returns no row for an archived membership,
 * a suspended Tenant, a foreign / malformed selector or no membership — proven
 * in pgTAP 115). The global profiles.role_id is Wolf Forge compatibility state
 * and must decide nothing, so every fake below gives the profile a role that
 * disagrees with the membership.
 */

const actor = { id: "20000000-0000-4000-8000-000000001501" } as VerifiedActor;

const roles = ["owner", "admin", "manager", "staff", "client"].map((name) => ({ id: `role-${name}`, name }));

type Membership = { account_class: string; role_name: string; tenant_id?: string };

function fakeClient(input: {
  membership: Membership[] | null;
  profileRole: string;
  profileArchived?: boolean;
}): UserScopedClient {
  const profile = {
    id: actor.id,
    role_id: `role-${input.profileRole}`,
    company_id: null,
    display_name: "Dual Tenant Person",
    avatar_url: null,
    archived_at: input.profileArchived ? "2026-10-08T00:00:00Z" : null,
  };
  const rpc = async (name: string) => {
    if (name === "app_current_tenant_membership") {
      return input.membership === null
        ? { data: null, error: { message: "denied" } }
        : { data: input.membership, error: null };
    }
    if (name === "app_current_user_permissions") return { data: [{ permission_key: "users.view" }], error: null };
    if (name === "app_current_user_modules") return { data: [], error: null };
    throw new Error(`unexpected rpc ${name}`);
  };
  const from = (table: string) => {
    if (table === "roles") return { select: async () => ({ data: roles, error: null }) };
    if (table === "profiles") {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { rpc, from } as unknown as UserScopedClient;
}

const internal = (role: string): Membership[] => [{ account_class: "internal", role_name: role }];
const client: Membership[] = [{ account_class: "client", role_name: "client" }];
const none: Membership[] = [];

describe("internal-app access derives from the current Tenant membership", () => {
  it("CASE 1: Tenant B internal staff with global profile role client enters the internal app", async () => {
    const user = await resolveInternalUser(fakeClient({ membership: internal("staff"), profileRole: "client" }), actor);
    expect(user?.role).toBe("staff");
    expect(user?.team.view).toBe(true);
  });

  it("CASE 2: Tenant B client membership never inherits a global owner / staff profile role", async () => {
    for (const profileRole of ["owner", "admin", "manager", "staff"]) {
      expect(await resolveInternalUser(fakeClient({ membership: client, profileRole }), actor)).toBeNull();
    }
  });

  it("CASE 3 / 4: one identity switches surface with the selected Tenant, not the profile", async () => {
    // Wolf Forge internal + Tenant B client: the B selector gets no internal access.
    expect(await resolveInternalUser(fakeClient({ membership: client, profileRole: "admin" }), actor)).toBeNull();
    expect((await resolveInternalUser(fakeClient({ membership: internal("admin"), profileRole: "admin" }), actor))?.role)
      .toBe("admin");
    // Wolf Forge client + Tenant B internal: the B selector is internal, WF is not.
    expect(await resolveInternalUser(fakeClient({ membership: client, profileRole: "client" }), actor)).toBeNull();
    expect((await resolveInternalUser(fakeClient({ membership: internal("manager"), profileRole: "client" }), actor))?.role)
      .toBe("manager");
  });

  it("CASE 5: a dual owner gets each Tenant's own membership role, not a platform-wide owner", async () => {
    expect((await resolveInternalUser(fakeClient({ membership: internal("owner"), profileRole: "owner" }), actor))?.role)
      .toBe("owner");
    expect((await resolveInternalUser(fakeClient({ membership: internal("staff"), profileRole: "owner" }), actor))?.role)
      .toBe("staff");
  });

  it("CASE 6-10: no current-Tenant membership row denies even a global owner", async () => {
    // archived membership, membership-less identity, foreign / unknown /
    // malformed selector and suspended Tenant all reach the gate as no row.
    expect(await resolveInternalUser(fakeClient({ membership: none, profileRole: "owner" }), actor)).toBeNull();
  });

  it("fails closed when the membership read errors", async () => {
    await expect(resolveInternalUser(fakeClient({ membership: null, profileRole: "owner" }), actor))
      .rejects.toMatchObject({ kind: "unavailable", stage: "membership" });
  });

  it("requires both an internal account class and an internal role", async () => {
    expect(await resolveInternalUser(
      fakeClient({ membership: [{ account_class: "internal", role_name: "client" }], profileRole: "owner" }),
      actor,
    )).toBeNull();
    expect(await resolveInternalUser(
      fakeClient({ membership: [{ account_class: "client", role_name: "owner" }], profileRole: "owner" }),
      actor,
    )).toBeNull();
  });

  it("still refuses an archived global identity", async () => {
    expect(await resolveInternalUser(
      fakeClient({ membership: internal("owner"), profileRole: "owner", profileArchived: true }),
      actor,
    )).toBeNull();
  });

  it("carries the database-validated current Tenant for Wolf Forge-only gates (D-285)", async () => {
    const tenantB = "f0f0f0f0-0000-4000-8000-000000002201";
    const user = await resolveInternalUser(
      fakeClient({ membership: [{ account_class: "internal", role_name: "owner", tenant_id: tenantB }], profileRole: "owner" }),
      actor,
    );
    expect(user?.tenantId).toBe(tenantB);
  });
});
