-- WL-2.2 (KI-110): permission overrides are Tenant-owned.
--
-- Concrete attack closed: public.profile_permission_overrides was keyed by
-- (profile_id, permission_key) only, and private.profile_has_permission applied
-- an override only to the Wolf Forge membership. Every write RPC validated the
-- caller and target in the CURRENT Tenant, then wrote that one global row, so a
-- Tenant B permission manager could grant, deny or clear a dual member's
-- Wolf Forge overrides (reproduced locally). Read RPCs counted / flagged the
-- global rows, and the member list and summary read the global (Wolf Forge
-- mirror) profile instead of the current Tenant's membership.
--
-- Model: an override belongs to one Tenant membership. (tenant_id, profile_id)
-- references tenant_memberships, so no Tenant can hold an override for a
-- profile that is not its member. Existing rows are Wolf Forge's: the Wolf
-- Forge membership was the only place an override ever took effect.
--
-- Pattern (D-272, no new helper): every override read and write is limited to
-- private.identity_tenant_id(), the caller's current Tenant, which is the same
-- Tenant private.profile_account_class() and
-- private.profile_permission_preset_key() already use to validate the target.
-- NULL (no / foreign / malformed selector, archived membership) matches
-- nothing, and the existing actor checks fail closed first.
--
-- The member list, the permission summary and the last-permission-manager
-- guard now read the current Tenant's tenant_memberships row instead of the
-- global profiles row. For Wolf Forge this is the same data: the WL-1A mirror
-- copies the profile's role, company and archive state onto its Wolf Forge
-- membership.
--
-- private.integration_actor_can_manage keeps its existing Wolf Forge-only
-- meaning: it reads the global Wolf Forge mirror profile. Integrations become
-- Tenant-scoped under D-270, not here.
--
-- Not changed here: preset / role changes and member provisioning still write
-- the global profiles row (KI-112).

alter table public.profile_permission_overrides
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    references public.tenants(id) on delete restrict;

alter table public.profile_permission_overrides
  alter column tenant_id set default private.identity_tenant_id();

alter table public.profile_permission_overrides
  drop constraint profile_permission_overrides_pkey,
  add constraint profile_permission_overrides_pkey
    primary key (tenant_id, profile_id, permission_key),
  add constraint profile_permission_overrides_membership_fkey
    foreign key (tenant_id, profile_id)
    references public.tenant_memberships(tenant_id, profile_id)
    on delete cascade;

create or replace function private.profile_has_permission(p_profile_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        case
          when preset_row.key = 'owner'
            then true

          else coalesce(
            (
              select profile_override.allowed
              from public.profile_permission_overrides as profile_override
              where profile_override.tenant_id = membership_row.tenant_id
                and profile_override.profile_id = membership_row.profile_id
                and profile_override.permission_key = p_permission_key
            ),
            (
              select preset_grant.allowed
              from public.role_permissions as preset_grant
              where preset_grant.role_id = membership_row.role_id
                and preset_grant.permission_key = p_permission_key
            ),
            false
          )
        end

      from public.tenant_memberships as membership_row

      join public.permission_presets as preset_row
        on preset_row.role_id = membership_row.role_id

      where membership_row.tenant_id = (select private.identity_tenant_id())
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null

        and exists (
          select 1
          from public.permissions as permission
          where permission.permission_key = p_permission_key
        )
    ),
    false
  );
$$;

create or replace function private.assert_permission_management_retained()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tenant_memberships as membership_row
    join public.permission_presets as preset_row
      on preset_row.role_id = membership_row.role_id
    where membership_row.tenant_id = (select private.identity_tenant_id())
      and membership_row.archived_at is null
      and preset_row.account_class = 'internal'
      and private.profile_has_permission(
        membership_row.profile_id,
        'users.manage_permissions'
      )
  ) then
    raise exception 'at least one active internal account must retain permission management'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.apply_profile_permission_override(p_profile_id uuid, p_permission_key text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_class text := private.profile_account_class(p_profile_id);
begin
  if target_class is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.permissions as permission_row
    where permission_row.permission_key = p_permission_key
  ) then
    raise exception 'unknown permission: %', p_permission_key
      using errcode = '22023';
  end if;

  if target_class = 'client'
    and p_allowed
    and not private.is_client_eligible_permission(p_permission_key)
  then
    raise exception 'client accounts cannot receive internal capability: %',
      p_permission_key
      using errcode = '42501';
  end if;

  insert into public.profile_permission_overrides (
    tenant_id,
    profile_id,
    permission_key,
    allowed
  )
  values (
    (select private.identity_tenant_id()),
    p_profile_id,
    p_permission_key,
    p_allowed
  )
  on conflict (tenant_id, profile_id, permission_key) do update
  set allowed = excluded.allowed,
      updated_at = now();
end;
$$;

create or replace function public.app_get_profile_effective_permissions(p_profile_id uuid default null)
returns table(permission_key text, category text, allowed boolean, source text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_id uuid := coalesce(p_profile_id, (select auth.uid()));
  target_preset text;
begin
  if actor_id is null then
    raise exception 'authentication is required'
      using errcode = '42501';
  end if;

  -- Anyone may read their own effective permissions. Reading another account's
  -- permission configuration is an administrative capability.
  if target_id <> actor_id then
    perform private.require_permission_manager();
  end if;

  target_preset := private.profile_permission_preset_key(target_id);

  if target_preset is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  return query
  select
    permission_row.permission_key,
    permission_row.category,
    private.profile_has_permission(
      target_id,
      permission_row.permission_key
    ),
    case
      when target_preset = 'owner' then 'preset'
      when exists (
        select 1
        from public.profile_permission_overrides as override_row
        where override_row.tenant_id = (select private.identity_tenant_id())
          and override_row.profile_id = target_id
          and override_row.permission_key = permission_row.permission_key
      ) then 'override'
      else 'preset'
    end
  from public.permissions as permission_row
  order by permission_row.permission_key;
end;
$$;

create or replace function public.app_get_profile_permission_summary(p_profile_id uuid default null)
returns table(profile_id uuid, display_name text, preset_key text, preset_name text, account_class text, company_id uuid, override_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_id uuid := coalesce(p_profile_id, (select auth.uid()));
begin
  if actor_id is null then
    raise exception 'authentication is required'
      using errcode = '42501';
  end if;

  if target_id <> actor_id then
    perform private.require_permission_manager();
  end if;

  return query
  select
    profile_row.id,
    profile_row.display_name,
    preset_row.key,
    preset_row.name,
    preset_row.account_class,
    membership_row.company_id,
    (
      select count(*)::integer
      from public.profile_permission_overrides as override_row
      where override_row.tenant_id = membership_row.tenant_id
        and override_row.profile_id = membership_row.profile_id
    )
  from public.tenant_memberships as membership_row
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
  join public.permission_presets as preset_row
    on preset_row.role_id = membership_row.role_id
  where membership_row.tenant_id = (select private.identity_tenant_id())
    and membership_row.profile_id = target_id
    and membership_row.archived_at is null;
end;
$$;

create or replace function public.app_set_profile_permission_override(p_profile_id uuid, p_permission_key text, p_allowed boolean)
returns public.profile_permission_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  override_row public.profile_permission_overrides;
  previous_effective boolean;
begin
  perform private.require_permission_admin_for_target(p_profile_id);

  if p_allowed is null then
    raise exception 'an override must be an explicit allow or deny'
      using errcode = '22023';
  end if;

  previous_effective := private.profile_has_permission(
    p_profile_id,
    p_permission_key
  );

  perform private.apply_profile_permission_override(
    p_profile_id,
    p_permission_key,
    p_allowed
  );

  perform private.assert_permission_management_retained();

  select * into override_row
  from public.profile_permission_overrides as stored
  where stored.tenant_id = (select private.identity_tenant_id())
    and stored.profile_id = p_profile_id
    and stored.permission_key = p_permission_key;

  perform private.record_authenticated_activity(
    'profile',
    p_profile_id,
    'permission.override_set',
    format(
      'Set a permission override for %s.',
      p_permission_key
    ),
    jsonb_build_object(
      'permission_key', p_permission_key,
      'allowed', p_allowed,
      'previous_effective', previous_effective,
      'effective', private.profile_has_permission(
        p_profile_id,
        p_permission_key
      ),
      'preset_key', private.profile_permission_preset_key(p_profile_id)
    )
  );

  return override_row;
end;
$$;

create or replace function public.app_clear_profile_permission_override(p_profile_id uuid, p_permission_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
  previous_effective boolean;
begin
  perform private.require_permission_admin_for_target(p_profile_id);

  previous_effective := private.profile_has_permission(
    p_profile_id,
    p_permission_key
  );

  delete from public.profile_permission_overrides as override_row
  where override_row.tenant_id = (select private.identity_tenant_id())
    and override_row.profile_id = p_profile_id
    and override_row.permission_key = p_permission_key;

  get diagnostics removed = row_count;

  if removed = 0 then
    return false;
  end if;

  perform private.assert_permission_management_retained();

  perform private.record_authenticated_activity(
    'profile',
    p_profile_id,
    'permission.override_cleared',
    format(
      'Cleared the permission override for %s.',
      p_permission_key
    ),
    jsonb_build_object(
      'permission_key', p_permission_key,
      'previous_effective', previous_effective,
      'effective', private.profile_has_permission(
        p_profile_id,
        p_permission_key
      ),
      'preset_key', private.profile_permission_preset_key(p_profile_id)
    )
  );

  return true;
end;
$$;

create or replace function public.app_grant_report_send_anytime(p_profile_id uuid)
returns public.profile_permission_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  override_row public.profile_permission_overrides;
begin
  actor_id := private.require_permission_admin_for_target(p_profile_id);
  perform private.require_non_owner_permission_target(p_profile_id);

  perform private.apply_profile_permission_override(
    p_profile_id, 'reports.send_anytime', true
  );

  select * into override_row
  from public.profile_permission_overrides as stored
  where stored.tenant_id = (select private.identity_tenant_id())
    and stored.profile_id = p_profile_id
    and stored.permission_key = 'reports.send_anytime';

  perform private.record_authenticated_activity(
    'profile',
    p_profile_id,
    'permission.report_send_anytime_granted',
    'Granted permission to send monthly reports anytime.',
    jsonb_build_object('permission_key', 'reports.send_anytime', 'granted_by', actor_id)
  );

  return override_row;
end;
$$;

create or replace function public.app_revoke_report_send_anytime(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  removed integer := 0;
begin
  actor_id := private.require_permission_admin_for_target(p_profile_id);
  perform private.require_non_owner_permission_target(p_profile_id);

  delete from public.profile_permission_overrides as override_row
  where override_row.tenant_id = (select private.identity_tenant_id())
    and override_row.profile_id = p_profile_id
    and override_row.permission_key = 'reports.send_anytime';

  get diagnostics removed = row_count;

  if removed > 0 then
    perform private.record_authenticated_activity(
      'profile',
      p_profile_id,
      'permission.report_send_anytime_revoked',
      'Revoked permission to send monthly reports anytime.',
      jsonb_build_object('permission_key', 'reports.send_anytime', 'revoked_by', actor_id)
    );
  end if;

  return removed > 0;
end;
$$;

create or replace function public.app_list_internal_members()
returns table(profile_id uuid, display_name text, email text, preset_key text, preset_name text, sort_order integer, override_count integer, is_self boolean, created_at timestamp with time zone, avatar_url text, report_send_anytime boolean)
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
      where override_row.tenant_id = membership_row.tenant_id
        and override_row.profile_id = membership_row.profile_id
    ),
    profile_row.id = actor_id,
    profile_row.created_at,
    profile_row.avatar_url,
    private.profile_has_permission(profile_row.id, 'reports.send_anytime')

  from public.tenant_memberships as membership_row

  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id

  join public.permission_presets as preset_row
    on preset_row.role_id = membership_row.role_id

  left join auth.users as auth_user
    on auth_user.id = profile_row.id

  where membership_row.tenant_id = (select private.identity_tenant_id())
    and membership_row.archived_at is null
    and preset_row.account_class = 'internal'

  order by
    preset_row.sort_order,
    coalesce(profile_row.display_name, auth_user.email::text),
    profile_row.id;
end;
$$;

create or replace function private.integration_actor_can_manage(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when role_row.name = 'owner' then true
      else coalesce(
        (select override_row.allowed
         from public.profile_permission_overrides as override_row
         where override_row.tenant_id = private.wolf_forge_tenant_id()
           and override_row.profile_id = profile_row.id
           and override_row.permission_key = 'integrations.manage'),
        (select role_permission.allowed
         from public.role_permissions as role_permission
         where role_permission.role_id = profile_row.role_id
           and role_permission.permission_key = 'integrations.manage'),
        false
      )
    end
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = p_actor_id
      and profile_row.archived_at is null
      and role_row.name in ('owner', 'admin', 'manager', 'staff')
  ), false);
$$;

comment on function public.app_list_internal_members() is
  'Internal member directory of the current Tenant for Team & Roles. report_send_anytime reflects the resolved reports.send_anytime permission in that Tenant (true for Owner unconditionally, or when an explicit override grants it).';
