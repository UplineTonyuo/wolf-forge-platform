import {
  clearProfileOverrideSchema,
  moduleKeySchema,
  setProfileOverrideSchema,
  setProfilePresetSchema,
  toModuleAccessMap,
  type EffectivePermission,
  type InternalMember,
  type ModuleAccess,
  type PermissionPreset,
  type PermissionPresetGrant,
  type PermissionPresetOverview,
  type ProfilePermissionSummary,
} from "../domain/permissions/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import type { PermissionRepository } from "../repositories/permission-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

/**
 * The database resolver is authoritative. This service validates shapes and
 * keeps the actor branded as server-verified; it never decides access itself
 * and never accepts a caller-supplied actor identity.
 */
export class PermissionService {
  constructor(private readonly dependencies: ServiceDependencies<PermissionRepository>) {}

  currentUserPermissions(): Promise<string[]> {
    return this.dependencies.repository.currentUserPermissions();
  }

  currentUserModules(): Promise<ModuleAccess[]> {
    return this.dependencies.repository.currentUserModules();
  }

  async currentUserModuleMap(): Promise<Record<string, boolean>> {
    return toModuleAccessMap(await this.dependencies.repository.currentUserModules());
  }

  /** Throws when the module is denied, so a typed URL cannot bypass the check. */
  requireModuleAccess(moduleKey: unknown): Promise<boolean> {
    return this.dependencies.repository.requireModuleAccess(parseInput(moduleKeySchema, moduleKey));
  }

  listPresets(): Promise<PermissionPreset[]> {
    return this.dependencies.repository.listPresets();
  }

  listInternalMembers(): Promise<InternalMember[]> {
    return this.dependencies.repository.listInternalMembers();
  }

  listPresetOverview(): Promise<PermissionPresetOverview[]> {
    return this.dependencies.repository.listPresetOverview();
  }

  listPresetGrants(): Promise<PermissionPresetGrant[]> {
    return this.dependencies.repository.listPresetGrants();
  }

  effectivePermissions(profileId?: unknown): Promise<EffectivePermission[]> {
    return this.dependencies.repository.effectivePermissions(
      profileId === undefined ? undefined : parseInput(uuidSchema, profileId),
    );
  }

  permissionSummary(profileId?: unknown): Promise<ProfilePermissionSummary> {
    return this.dependencies.repository.permissionSummary(
      profileId === undefined ? undefined : parseInput(uuidSchema, profileId),
    );
  }

  async setPreset(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setPreset(parseInput(setProfilePresetSchema, input));
  }

  async setOverride(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setOverride(parseInput(setProfileOverrideSchema, input));
  }

  /** Removing an override returns the profile to plain preset inheritance. */
  async clearOverride(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.clearOverride(parseInput(clearProfileOverrideSchema, input));
  }

  async grantReportSendAnytime(profileId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.grantReportSendAnytime(parseInput(uuidSchema, profileId));
  }

  async revokeReportSendAnytime(profileId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.revokeReportSendAnytime(parseInput(uuidSchema, profileId));
  }
}
