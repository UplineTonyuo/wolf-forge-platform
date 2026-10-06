import { describe, expect, it, vi } from "vitest";
import {
  permissionOverrideListSchema,
  provisionClientAccountSchema,
  provisionInternalMemberSchema,
  setProfileOverrideSchema,
  setProfilePresetSchema,
  toModuleAccessMap,
  type ModuleAccess,
} from "../domain/permissions/schema";
import type { PublicEnvironment } from "../lib/env/index";
import { PermissionDeniedError } from "../lib/errors/application-error";
import { AuthAdminError } from "../lib/supabase/auth-admin";
import { createUserSupabaseClient, verifyActor, type VerifiedActor } from "../lib/supabase/user-client";
import { AccountProvisioningService } from "../services/account-provisioning-service";
import { PermissionService } from "../services/permission-service";

const profileId = "20000000-0000-4000-8000-000000000001";
const companyId = "20000000-0000-4000-8000-000000000002";

describe("permission preset and override validation", () => {
  it("keeps internal and client presets in separate account classes", () => {
    expect(setProfilePresetSchema.safeParse({ profile_id: profileId, preset_key: "manager" }).success).toBe(true);
    expect(setProfilePresetSchema.safeParse({ profile_id: profileId, preset_key: "client" }).success).toBe(true);
    expect(setProfilePresetSchema.safeParse({ profile_id: profileId, preset_key: "superuser" }).success).toBe(false);

    expect(provisionInternalMemberSchema.safeParse({
      email: "member@example.invalid",
      temporary_password: "temporary-secret",
      preset_key: "client",
    }).success).toBe(false);
  });

  it("requires an explicit allow or deny and rejects duplicate override keys", () => {
    expect(setProfileOverrideSchema.safeParse({
      profile_id: profileId,
      permission_key: "clients.view",
      allowed: false,
    }).success).toBe(true);

    expect(setProfileOverrideSchema.safeParse({
      profile_id: profileId,
      permission_key: "clients.view",
    }).success).toBe(false);

    expect(setProfileOverrideSchema.safeParse({
      profile_id: profileId,
      permission_key: "clientsview",
      allowed: true,
    }).success).toBe(false);

    expect(permissionOverrideListSchema.safeParse([
      { permission_key: "clients.view", allowed: false },
      { permission_key: "clients.view", allowed: true },
    ]).success).toBe(false);
  });

  it("requires a real company for a client account and a usable temporary password", () => {
    const base = {
      email: "Client@Example.Invalid",
      temporary_password: "temporary-secret",
    };

    expect(provisionClientAccountSchema.safeParse(base).success).toBe(false);
    expect(provisionClientAccountSchema.safeParse({ ...base, company_name: "Acme" }).success).toBe(true);
    expect(provisionClientAccountSchema.safeParse({ ...base, company_id: companyId }).success).toBe(true);
    expect(provisionClientAccountSchema.safeParse({
      ...base,
      company_name: "Acme",
      temporary_password: "short",
    }).success).toBe(false);

    const parsed = provisionClientAccountSchema.parse({ ...base, company_name: "Acme" });
    expect(parsed.email).toBe("client@example.invalid");

    // The welcome-email path creates the login with no password (KI-091); members still need one.
    expect(provisionClientAccountSchema.safeParse({ email: base.email, company_name: "Acme" }).success).toBe(true);
    expect(provisionInternalMemberSchema.safeParse({ email: base.email, preset_key: "staff" }).success).toBe(false);
  });

  it("derives module visibility from real capabilities", () => {
    const modules: ModuleAccess[] = [
      {
        module_key: "clients",
        label: "Clients",
        account_class: "internal",
        required_permission_key: "clients.view",
        granted: false,
      },
      {
        module_key: "projects",
        label: "Projects",
        account_class: "internal",
        required_permission_key: "projects.view",
        granted: true,
      },
    ];

    expect(toModuleAccessMap(modules)).toEqual({ clients: false, projects: true });
  });
});

function verifiedActor(): VerifiedActor {
  return { id: profileId } as VerifiedActor;
}

/**
 * A real branded actor. The brand is a runtime WeakSet, so the only way to get
 * one is through verifyActor -- which is the point: a cast cannot forge it.
 */
async function serverVerifiedActor(): Promise<VerifiedActor> {
  const client = createUserSupabaseClient(
    {
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    } as PublicEnvironment,
    "test-access-token",
  );

  vi.spyOn(client.auth, "getClaims").mockResolvedValue({
    data: { claims: { sub: profileId } },
    error: null,
  } as never);

  return verifyActor(client);
}

describe("permission and provisioning service boundaries", () => {
  it("refuses permission mutations without a server-verified actor", async () => {
    const repository = { setPreset: vi.fn(), setOverride: vi.fn(), clearOverride: vi.fn() };
    const service = new PermissionService({ repository: repository as never });

    await expect(
      service.setPreset({ profile_id: profileId, preset_key: "admin" }, verifiedActor()),
    ).rejects.toThrow("server-verified actor");

    await expect(
      service.setOverride(
        { profile_id: profileId, permission_key: "clients.view", allowed: false },
        verifiedActor(),
      ),
    ).rejects.toThrow("server-verified actor");

    await expect(
      service.clearOverride({ profile_id: profileId, permission_key: "clients.view" }, verifiedActor()),
    ).rejects.toThrow("server-verified actor");

    expect(repository.setPreset).not.toHaveBeenCalled();
    expect(repository.setOverride).not.toHaveBeenCalled();
    expect(repository.clearOverride).not.toHaveBeenCalled();
  });

  it("refuses account provisioning without a server-verified actor", async () => {
    const authAdmin = { createUser: vi.fn(), deleteUser: vi.fn() };
    const service = new AccountProvisioningService({
      permissions: {} as never,
      companies: {} as never,
      contacts: {} as never,
      authAdmin: authAdmin as never,
    });

    await expect(
      service.provisionInternalMember(
        {
          email: "member@example.invalid",
          temporary_password: "temporary-secret",
          preset_key: "manager",
        },
        verifiedActor(),
      ),
    ).rejects.toThrow("server-verified actor");

    // No auth user is created when the actor cannot be trusted.
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it("creates the auth user first, then completes provisioning on the chosen preset", async () => {
    const authAdmin = {
      createUser: vi.fn().mockResolvedValue({ id: profileId, email: "member@example.invalid" }),
      deleteUser: vi.fn(),
    };
    const permissions = {
      provisionInternalMemberProfile: vi.fn().mockResolvedValue({ id: profileId }),
    };
    const service = new AccountProvisioningService({
      permissions: permissions as never,
      companies: {} as never,
      contacts: {} as never,
      authAdmin: authAdmin as never,
    });

    const account = await service.provisionInternalMember(
      {
        email: "Member@Example.Invalid",
        first_name: "Casey",
        last_name: "Field",
        temporary_password: "temporary-secret",
        preset_key: "manager",
      },
      await serverVerifiedActor(),
    );

    expect(authAdmin.createUser).toHaveBeenCalledWith({
      email: "member@example.invalid",
      password: "temporary-secret",
      displayName: "Casey Field",
    });

    // The database decides access; the adapter only creates the login.
    expect(permissions.provisionInternalMemberProfile).toHaveBeenCalledWith(
      profileId,
      "manager",
      "Casey Field",
      [],
    );

    // A Wolf Forge member is never scoped to a company.
    expect(account.companyId).toBeNull();
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("rolls the auth user back when the provisioning RPC rejects the request", async () => {
    const authAdmin = {
      createUser: vi.fn().mockResolvedValue({ id: profileId, email: "member@example.invalid" }),
      deleteUser: vi.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      provisionInternalMemberProfile: vi
        .fn()
        .mockRejectedValue(new PermissionDeniedError()),
    };
    const service = new AccountProvisioningService({
      permissions: permissions as never,
      companies: {} as never,
      contacts: {} as never,
      authAdmin: authAdmin as never,
    });

    await expect(
      service.provisionInternalMember(
        {
          email: "member@example.invalid",
          temporary_password: "temporary-secret",
          preset_key: "staff",
        },
        await serverVerifiedActor(),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // auth.users lives outside the Postgres transaction, so it is compensated.
    expect(authAdmin.deleteUser).toHaveBeenCalledWith(profileId);
  });

  it("adds a second portal user to an existing Company without creating a second primary contact", async () => {
    const authAdmin = {
      createUser: vi.fn().mockResolvedValue({ id: profileId, email: "second@example.invalid" }),
      deleteUser: vi.fn(),
    };
    const permissions = {
      provisionClientAccountProfile: vi.fn().mockResolvedValue({ id: profileId }),
    };
    const companies = { create: vi.fn(), archive: vi.fn() };
    const contacts = {
      listForCompany: vi.fn().mockResolvedValue([{ id: "existing-primary", is_primary: true }]),
      create: vi.fn().mockResolvedValue({ id: "new-contact" }),
    };
    const service = new AccountProvisioningService({
      permissions: permissions as never,
      companies: companies as never,
      contacts: contacts as never,
      authAdmin: authAdmin as never,
    });

    await service.provisionClientAccount(
      {
        email: "second@example.invalid",
        temporary_password: "temporary-secret",
        company_id: companyId,
      },
      await serverVerifiedActor(),
    );

    expect(companies.create).not.toHaveBeenCalled();
    expect(contacts.listForCompany).toHaveBeenCalledWith(companyId);
    expect(contacts.create).toHaveBeenCalledWith(expect.objectContaining({
      company_id: companyId,
      profile_id: profileId,
      is_primary: false,
    }));
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("classifies a duplicate account without leaking the auth admin failure", () => {
    const failure = new AuthAdminError({
      reason: "already_exists",
      message: "A user with this email address has already been registered",
    });

    expect(failure.failure.reason).toBe("already_exists");
    expect(failure.message).not.toContain("secret");
  });
});
