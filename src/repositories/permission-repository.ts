import type {
  ClearProfileOverrideInput,
  EffectivePermission,
  ModuleAccess,
  PermissionOverrideInput,
  PermissionPreset,
  ProfilePermissionSummary,
  SetProfileOverrideInput,
  SetProfilePresetInput,
} from "../domain/permissions/schema";
import type { ProfileRow } from "../lib/supabase/database-rows";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

/**
 * Every call goes through an audited SECURITY DEFINER RPC. The permission
 * tables themselves are revoked from every API role, so there is no direct
 * table path to fall back on.
 */
export class PermissionRepository {
  constructor(private readonly client: UserMutationClient) {}

  async currentUserPermissions(): Promise<string[]> {
    const rows = unwrapMany(await this.client.rpc("app_current_user_permissions"));
    return rows.map((row) => row.permission_key);
  }

  async currentUserModules(): Promise<ModuleAccess[]> {
    return unwrapMany(
      await this.client.rpc("app_current_user_modules"),
    ) as ModuleAccess[];
  }

  /** Server-side module rejection; the caller identity comes from the session. */
  async requireModuleAccess(moduleKey: string): Promise<boolean> {
    return unwrapOne(
      await this.client.rpc("app_require_module_access", { p_module_key: moduleKey }),
      "Module",
    );
  }

  async listPresets(): Promise<PermissionPreset[]> {
    return unwrapMany(
      await this.client.rpc("app_list_permission_presets"),
    ) as PermissionPreset[];
  }

  /** Omit the profile id to read your own effective permissions. */
  async effectivePermissions(profileId?: string): Promise<EffectivePermission[]> {
    return unwrapMany(
      await this.client.rpc("app_get_profile_effective_permissions", {
        p_profile_id: profileId ?? undefined,
      }),
    ) as EffectivePermission[];
  }

  async permissionSummary(profileId?: string): Promise<ProfilePermissionSummary> {
    const rows = unwrapMany(
      await this.client.rpc("app_get_profile_permission_summary", {
        p_profile_id: profileId ?? undefined,
      }),
    ) as ProfilePermissionSummary[];

    return unwrapOne({ data: rows[0] ?? null, error: null }, "Profile");
  }

  async setPreset(input: SetProfilePresetInput): Promise<ProfileRow> {
    return unwrapOne(
      await this.client.rpc("app_set_profile_permission_preset", {
        p_profile_id: input.profile_id,
        p_preset_key: input.preset_key,
      }),
      "Profile",
    );
  }

  async setOverride(input: SetProfileOverrideInput): Promise<void> {
    unwrapOne(
      await this.client.rpc("app_set_profile_permission_override", {
        p_profile_id: input.profile_id,
        p_permission_key: input.permission_key,
        p_allowed: input.allowed,
      }),
      "Permission override",
    );
  }

  /** Returns false when there was no override to remove. */
  async clearOverride(input: ClearProfileOverrideInput): Promise<boolean> {
    const result = await this.client.rpc("app_clear_profile_permission_override", {
      p_profile_id: input.profile_id,
      p_permission_key: input.permission_key,
    });

    // `false` is a valid answer here, so the boolean cannot go through unwrapOne.
    if (result.error) throw mapDatabaseError(result.error, "Permission override");
    return result.data === true;
  }

  async provisionInternalMemberProfile(
    profileId: string,
    presetKey: string,
    displayName: string | null,
    overrides: PermissionOverrideInput[],
  ): Promise<ProfileRow> {
    return unwrapOne(
      await this.client.rpc("app_provision_internal_member_profile", {
        p_profile_id: profileId,
        p_preset_key: presetKey,
        p_display_name: displayName ?? undefined,
        p_overrides: overrides,
      }),
      "Profile",
    );
  }

  async provisionClientAccountProfile(
    profileId: string,
    companyId: string,
    displayName: string | null,
    overrides: PermissionOverrideInput[],
  ): Promise<ProfileRow> {
    return unwrapOne(
      await this.client.rpc("app_provision_client_account_profile", {
        p_profile_id: profileId,
        p_company_id: companyId,
        p_display_name: displayName ?? undefined,
        p_overrides: overrides,
      }),
      "Profile",
    );
  }
}
