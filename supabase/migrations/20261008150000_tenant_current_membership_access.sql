-- WL-2.18 (KI-115): internal-app access comes from the current Tenant membership.
--
-- Before: src/lib/supabase/next-server.ts decided internal-app access and the
-- displayed role from the global Wolf Forge compatibility field
-- profiles.role_id. A Tenant B staff member whose profile keeps role 'client'
-- was refused, and the role shown under a Tenant B selector was the Wolf Forge
-- one. tenant_memberships has no SELECT grant, so the application had no way to
-- read the caller's own current-Tenant membership.
--
-- After: the application reads the caller's own active membership in
-- private.current_tenant_id() (selector authorized against membership + active
-- Tenant, NULL on any selector failure) and decides internal vs client from it.
-- No row = no current-Tenant membership: archived, suspended Tenant, foreign or
-- malformed selector, or a membership-less identity. Caller-only, no argument,
-- so it is no membership oracle for anyone else. The roles catalog stays global.

create function public.app_current_tenant_membership()
returns table(account_class text, role_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select membership_row.account_class, role_row.name
  from public.tenant_memberships as membership_row
  join public.roles as role_row
    on role_row.id = membership_row.role_id
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null;
$$;

revoke all on function public.app_current_tenant_membership() from public, anon, service_role;
grant execute on function public.app_current_tenant_membership() to authenticated;
