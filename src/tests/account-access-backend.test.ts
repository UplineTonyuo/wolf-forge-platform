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
import { AuthAdminError } from "../lib/supabase/auth-admin";
import type { VerifiedActor } from "../lib/supabase/user-client";
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

  it("classifies a duplicate account without leaking the auth admin failure", () => {
    const failure = new AuthAdminError({
      reason: "already_exists",
      message: "A user with this email address has already been registered",
    });

    expect(failure.failure.reason).toBe("already_exists");
    expect(failure.message).not.toContain("secret");
  });
});
