-- Wolf Forge Platform
-- White Label WL-1B Checkpoint A: request Tenant context resolution.
--
-- Transport (D-6b): trusted server code resolves the Tenant from a verified
-- hostname and sends it as the `x-wf-tenant` header on the user-scoped
-- Supabase client. PostgREST exposes request headers transaction-locally in
-- the `request.headers` setting.
--
-- The header is a SELECTOR, never a credential: any signed-in user can call
-- PostgREST directly with any value. The only authorization is an active
-- membership of auth.uid() in an active Tenant, checked here.
--
-- Additive only: no existing table, policy, grant or function changes. Nothing
-- calls this function yet.

-- Selector rules:
--   header absent                  -> compatibility fallback: the Wolf Forge
--                                     Tenant, still membership-checked
--   header present and a UUID      -> that Tenant, membership-checked
--   header present, anything else  -> NULL (empty, malformed, comma-joined
--                                     duplicates). Never the fallback.
-- No membership, archived membership, inactive Tenant or no auth.uid() -> NULL.
--
-- The UUID is pattern-checked before the cast, so no header value can raise.
-- Paths that do not go through PostgREST (direct SQL, cron, service-role jobs)
-- have no auth.uid() and therefore resolve to NULL.
--
-- SECURITY DEFINER because both Tenant tables are unreadable to browser roles.
-- The owner's BYPASSRLS is what lets it read them under FORCE RLS; that is
-- intended, because the membership predicate below is the authorization. It
-- reads no RLS-protected policy that calls back into it.
create function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with selector as (
    select nullif(current_setting('request.headers', true), '')::jsonb -> 'x-wf-tenant' as raw
  ),
  requested as (
    select
      case
        when selector.raw is null
          then private.wolf_forge_tenant_id()
        when jsonb_typeof(selector.raw) = 'string'
          and (selector.raw #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (selector.raw #>> '{}')::uuid
      end as tenant_id
    from selector
  )
  select membership_row.tenant_id
  from requested
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = requested.tenant_id
   and membership_row.profile_id = (select auth.uid())
   and membership_row.archived_at is null
  join public.tenants as tenant_row
    on tenant_row.id = membership_row.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null;
$$;

revoke all on function private.current_tenant_id() from public, anon, service_role;
grant execute on function private.current_tenant_id() to authenticated;

comment on function private.current_tenant_id()
is 'WL-1B: the Tenant of the current request. x-wf-tenant is a selector only; returns it only when auth.uid() holds an active membership in that active Tenant. Absent header falls back to Wolf Forge (membership-checked); a present but invalid header never does.';
