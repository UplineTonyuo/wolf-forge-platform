/** The fixed Wolf Forge Tenant #1 (`private.wolf_forge_tenant_id()`). */
export const WOLF_FORGE_TENANT_ID = "f0f0f0f0-0000-4000-8000-000000000001";

/**
 * True only for the database-validated current Tenant of a resolved internal
 * user (`InternalUser.tenantId`, from `app_current_tenant_membership`). Never
 * pass a value read from the request.
 */
export function isWolfForgeTenant(tenantId: string | null | undefined): boolean {
  return tenantId === WOLF_FORGE_TENANT_ID;
}
