-- Wolf Forge Platform - Team & Roles read models
--
-- The account access engine (presets, modules, resolver, provisioning) already
-- exists in 20260815100000. What it does not have is a *read* boundary the Team
-- screen can use:
--
--   public.profiles              has no email; email lives in auth.users
--   public.permission_presets    revoked from every API role
--   public.permissions           revoked from every API role
--   public.role_permissions      revoked from every API role
--
-- So a session client cannot see a member's email, the display name of their
-- preset, or what a preset actually grants. These are three read-only RPCs that
-- close that gap on the existing audited boundary. No table is added, no grant
-- is changed, and nothing here can mutate access.
--
-- Every one is gated on the same capability that already gates the Team module
-- (public.permission_modules: 'team' -> 'users.view'), so navigation visibility
-- and directory readability share one boundary.

-- -----------------------------------------------------------------------------
-- Team directory
-- -----------------------------------------------------------------------------

-- Client portal accounts are a separate security domain and are structurally
-- excluded here: the internal employee directory only ever lists the internal
-- account class.
create or replace function public.app_list_internal_members()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  preset_key text,
  preset_name text,
  sort_order integer,
  override_count integer,
  is_self boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('users.view');

  return query
  select
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    preset_row.key,
    preset_row.name,
    preset_row.sort_order,
    (
      select count(*)::integer
      from public.profile_permission_overrides as override_row
      where override_row.profile_id = profile_row.id
    ),
    profile_row.id = actor_id,
    profile_row.created_at

  from public.profiles as profile_row

  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id

  left join auth.users as auth_user
    on auth_user.id = profile_row.id

  where profile_row.archived_at is null
    and preset_row.account_class = 'internal'

  order by
    preset_row.sort_order,
    coalesce(profile_row.display_name, auth_user.email::text),
    profile_row.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Role map
-- -----------------------------------------------------------------------------

-- Member counts and access breadth are derived from the real grant store, never
-- from a duplicated frontend table. The owner preset reports full breadth
-- because private.profile_has_permission gives it a resolver bypass rather than
-- an exhaustive set of rows in public.role_permissions.
create or replace function public.app_list_permission_preset_overview()
returns table (
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
      from public.profiles as profile_row
      where profile_row.role_id = preset_row.role_id
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

-- -----------------------------------------------------------------------------
-- Preset grant detail
-- -----------------------------------------------------------------------------

-- The full capability catalog crossed with every preset, so the Roles screen can
-- render real grants grouped by the real category instead of a hardcoded list.
-- Preset authoring stays deferred; this is read-only by construction.
create or replace function public.app_list_permission_preset_grants()
returns table (
  preset_key text,
  permission_key text,
  category text,
  label text,
  description text,
  allowed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform private.require_permission('users.view');

  return query
  select
    preset_row.key,
    permission_row.permission_key,
    permission_row.category,
    permission_row.label,
    permission_row.description,
    case
      when preset_row.key = 'owner' then true
      else coalesce(preset_grant.allowed, false)
    end

  from public.permission_presets as preset_row

  cross join public.permissions as permission_row

  left join public.role_permissions as preset_grant
    on preset_grant.role_id = preset_row.role_id
    and preset_grant.permission_key = permission_row.permission_key

  order by
    preset_row.sort_order,
    permission_row.category,
    permission_row.permission_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke all on function public.app_list_internal_members()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_internal_members()
to authenticated;

revoke all on function public.app_list_permission_preset_overview()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_permission_preset_overview()
to authenticated;

revoke all on function public.app_list_permission_preset_grants()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_permission_preset_grants()
to authenticated;

comment on function public.app_list_internal_members()
is 'Read boundary for the internal employee directory. Requires users.view, the same capability that gates the team module. Client portal accounts are never listed.';

comment on function public.app_list_permission_preset_overview()
is 'Real member counts and access breadth per preset, derived from public.profiles and public.role_permissions so the role map never carries its own numbers.';

comment on function public.app_list_permission_preset_grants()
is 'The capability catalog crossed with every preset. Read-only: preset grants remain system-managed through public.role_permissions.';
