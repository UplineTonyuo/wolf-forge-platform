/**
 * The Tenant selector sent from trusted server code to PostgREST (D-6b).
 *
 * It is a SELECTOR, never a credential. Any signed-in user can call PostgREST
 * directly with any value, so `private.current_tenant_id()` only returns the
 * Tenant when `auth.uid()` holds an active membership in it.
 *
 * Two trust boundaries share this header name and must stay separate:
 *   - inbound browser -> Next.js: never trusted. `src/proxy.ts` overwrites it
 *     with the Tenant of the verified request host (WL-2.22b), so no server
 *     code can read a client-supplied value by mistake.
 *   - outbound server -> PostgREST: set only from a Tenant the server resolved
 *     itself, through `createUserSupabaseClient(..., selector)`.
 */
export const TENANT_SELECTOR_HEADER = "x-wf-tenant";

declare const tenantSelectorBrand: unique symbol;

/** A Tenant id the server resolved itself. Build one only via `toTenantSelector`. */
export type TenantSelector = string & { readonly [tenantSelectorBrand]: true };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pass only a server-resolved Tenant id, never a value read from the request. */
export function toTenantSelector(tenantId: string): TenantSelector {
  if (!UUID_PATTERN.test(tenantId)) throw new Error("Tenant selector must be a UUID.");
  return tenantId.toLowerCase() as TenantSelector;
}
