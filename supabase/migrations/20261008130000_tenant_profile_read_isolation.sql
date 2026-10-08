-- WL-2.16 (KI-120): internal profile reads are scoped to the current Tenant.
--
-- profiles stay global identity (no tenant_id). An internal user may read a
-- profile only when that profile has a membership (active or archived) in the
-- caller's current Tenant: current Tenant -> tenant_memberships -> profiles.
--
-- Before: profiles_internal_select was is_internal_user() alone, so an internal
-- member of any Tenant read every global profile (display name, avatar, and the
-- Wolf Forge compatibility fields role_id / company_id), including identities
-- that belong only to other Tenants or to no Tenant. The role map
-- (app_list_permission_preset_overview) counted every global profile by its
-- Wolf Forge compatibility role_id.
--
-- After: foreign-Tenant-only and membership-less identities are invisible to
-- ordinary internal reads; a dual-Tenant identity is visible from either
-- Tenant. Self access is unchanged: an internal caller always has a membership
-- in the current Tenant (is_internal_user requires it), and clients keep
-- profiles_client_select_own. The role map counts the current Tenant's
-- memberships. current_tenant_id() is NULL for any selector failure, which
-- makes both predicates false.

create function private.is_current_tenant_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Internal callers only, so the helper is no membership oracle for clients.
  select (select private.is_internal_user())
    and exists (
      select 1
      from public.tenant_memberships as membership_row
      where membership_row.tenant_id = (select private.current_tenant_id())
        and membership_row.profile_id = p_profile_id
    );
$$;

revoke all on function private.is_current_tenant_profile(uuid) from public;
grant execute on function private.is_current_tenant_profile(uuid) to authenticated;

drop policy profiles_internal_select on public.profiles;

create policy profiles_internal_select
on public.profiles
for select
to authenticated
using (
  (select private.is_internal_user())
  and private.is_current_tenant_profile(id)
);

create or replace function public.app_list_permission_preset_overview()
returns table(
  preset_key text,
  preset_name text,
  account_class text,
  sort_order integer,
  member_count integer,
  granted_permission_count integer,
  total_permission_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  permission_total integer;
begin
  perform private.require_internal_actor();
  perform private.require_permission('users.view');

  select count(*)::integer into permission_total
  from public.permissions;

  return query
  select
    preset_row.key,
    preset_row.name,
    preset_row.account_class,
    preset_row.sort_order,
    (
      select count(*)::integer
      from public.tenant_memberships as membership_row
      join public.profiles as profile_row
        on profile_row.id = membership_row.profile_id
      where membership_row.tenant_id = (select private.identity_tenant_id())
        and membership_row.role_id = preset_row.role_id
        and membership_row.archived_at is null
        and profile_row.archived_at is null
    ),
    case
      when preset_row.key = 'owner' then permission_total
      else (
        select count(*)::integer
        from public.role_permissions as preset_grant
        where preset_grant.role_id = preset_row.role_id
          and preset_grant.allowed
      )
    end,
    permission_total

  from public.permission_presets as preset_row
  order by preset_row.sort_order, preset_row.key;
end;
$$;

comment on function public.app_list_permission_preset_overview()
is 'Real member counts and access breadth per preset, derived from the current Tenant''s active memberships and public.role_permissions so the role map never carries its own numbers.';
