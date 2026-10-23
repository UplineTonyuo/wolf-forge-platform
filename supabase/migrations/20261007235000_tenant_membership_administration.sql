-- WL-2.3 (KI-112): membership administration writes the current Tenant's
-- membership only.
--
-- Concrete attack closed: app_set_profile_permission_preset,
-- app_provision_internal_member_profile and app_assign_client_profile_to_company
-- (also reached through app_provision_client_account_profile) validated the
-- caller and the target in the CURRENT Tenant, then wrote the global
-- profiles.role_id / company_id. The WL-1A mirror copies those columns onto the
-- Wolf Forge membership only, so a Tenant B permission manager promoted or
-- demoted a dual member's Wolf Forge role (reproduced locally) while the
-- Tenant B membership stayed unchanged, the per-Tenant last-manager guard never
-- saw the Wolf Forge change, and a Tenant B client administrator could link a
-- dual client to a Wolf Forge Client (the Client lookup had no Tenant
-- predicate).
--
-- Model: tenant_memberships holds the Tenant-relative role, account class and
-- Client link. profiles.role_id / company_id stay as Wolf Forge compatibility
-- state: in the Wolf Forge Tenant these functions keep writing the profile and
-- the existing mirror keeps the Wolf Forge membership in step. In any other
-- Tenant they update only that Tenant's membership row, never the profile, and
-- there is no reverse sync. Global identity (display_name) is not written from
-- another Tenant.
--
-- Pattern (D-272 / D-273, no new helper): the Tenant is
-- private.identity_tenant_id(), the one private.profile_account_class() and
-- private.profile_permission_preset_key() already use to validate the target.
-- The Client must belong to that Tenant; the existing (tenant_id, company_id)
-- foreign key and the internal-has-no-company check still apply. NULL Tenant
-- matches no row and fails closed with the existing errors.
-- private.assert_permission_management_retained() is already per Tenant
-- (WL-2.2); a preset change now writes the same Tenant the guard checks.

create or replace function public.app_set_profile_permission_preset(p_profile_id uuid, p_preset_key text)
 returns public.profiles
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  profile_row public.profiles;
  preset_row public.permission_presets;
  previous_preset text;
  actor_tenant_id uuid := (select private.identity_tenant_id());
begin
  perform private.require_permission_admin_for_target(p_profile_id);

  select * into preset_row
  from public.permission_presets as candidate
  where candidate.key = p_preset_key;

  if preset_row.id is null then
    raise exception 'unknown permission preset: %', p_preset_key
      using errcode = '22023';
  end if;

  previous_preset := private.profile_permission_preset_key(p_profile_id);

  -- An account never changes security domain through a preset change. Internal
  -- staff and client portal accounts are separate provisioning paths.
  if private.profile_account_class(p_profile_id) <> preset_row.account_class then
    raise exception
      'a % account cannot be assigned the % preset',
      private.profile_account_class(p_profile_id),
      preset_row.account_class
      using errcode = '42501';
  end if;

  -- Creating another owner requires the strongest existing management
  -- capability rather than any hardcoded identity.
  if preset_row.key = 'owner' then
    perform private.require_permission('users.manage_permissions');
  end if;

  if previous_preset = preset_row.key then
    select * into profile_row
    from public.profiles as existing
    where existing.id = p_profile_id;

    return profile_row;
  end if;

  if actor_tenant_id = private.wolf_forge_tenant_id() then
    -- Wolf Forge compatibility: the mirror carries the role to the membership.
    update public.profiles as target_profile
    set role_id = preset_row.role_id
    where target_profile.id = p_profile_id
      and target_profile.archived_at is null
    returning target_profile.* into profile_row;
  else
    update public.tenant_memberships as membership_row
    set role_id = preset_row.role_id
    where membership_row.tenant_id = actor_tenant_id
      and membership_row.profile_id = p_profile_id
      and membership_row.archived_at is null;

    if found then
      select * into profile_row
      from public.profiles as existing
      where existing.id = p_profile_id;
    end if;
  end if;

  if profile_row.id is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  perform private.assert_permission_management_retained();

  perform private.record_authenticated_activity(
    'profile',
    profile_row.id,
    'permission.preset_changed',
    format(
      'Changed the permission preset from %s to %s.',
      previous_preset,
      preset_row.key
    ),
    jsonb_build_object(
      'previous_preset_key', previous_preset,
      'preset_key', preset_row.key,
      'account_class', preset_row.account_class
    )
  );

  return profile_row;
end;
$$;

create or replace function public.app_provision_internal_member_profile(p_profile_id uuid, p_preset_key text, p_display_name text default null::text, p_overrides jsonb default '[]'::jsonb)
 returns public.profiles
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  profile_row public.profiles;
  preset_row public.permission_presets;
  existing_class text;
  existing_preset text;
  normalized_display_name text := nullif(btrim(p_display_name), '');
  was_provisioned boolean := false;
  actor_tenant_id uuid := (select private.identity_tenant_id());
begin
  perform private.require_permission('users.create');

  if p_profile_id is null then
    raise exception 'a target profile is required'
      using errcode = '22023';
  end if;

  select * into preset_row
  from public.permission_presets as candidate
  where candidate.key = p_preset_key;

  if preset_row.id is null then
    raise exception 'unknown permission preset: %', p_preset_key
      using errcode = '22023';
  end if;

  if preset_row.account_class <> 'internal' then
    raise exception 'a Wolf Forge member requires an internal preset'
      using errcode = '42501';
  end if;

  -- Assigning a preset at all is permission administration; the owner preset
  -- additionally requires the strongest existing management capability.
  perform private.require_permission('users.manage_permissions');

  existing_class := private.profile_account_class(p_profile_id);
  existing_preset := private.profile_permission_preset_key(p_profile_id);

  if existing_class is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  -- A freshly created auth user arrives as an unclaimed client-class profile.
  -- A retry of the same request finds it already internal on the same preset.
  -- Both checks read the current Tenant's membership and contacts.
  if existing_class = 'client' then
    if exists (
      select 1
      from public.tenant_memberships as candidate
      where candidate.tenant_id = actor_tenant_id
        and candidate.profile_id = p_profile_id
        and candidate.company_id is not null
    )
      or exists (
        select 1
        from public.client_contacts as contact_row
        where contact_row.tenant_id = actor_tenant_id
          and contact_row.profile_id = p_profile_id
      )
    then
      raise exception 'an existing client portal account cannot become a Wolf Forge member'
        using errcode = '42501';
    end if;

    was_provisioned := true;
  elsif existing_preset <> preset_row.key then
    raise exception
      'this account already exists as a Wolf Forge member; change its preset instead'
      using errcode = '42501';
  end if;

  if actor_tenant_id = private.wolf_forge_tenant_id() then
    -- Wolf Forge compatibility: the mirror carries the role to the membership.
    update public.profiles as target_profile
    set
      role_id = preset_row.role_id,
      company_id = null,
      display_name = coalesce(
        normalized_display_name,
        target_profile.display_name
      )
    where target_profile.id = p_profile_id
      and target_profile.archived_at is null
    returning target_profile.* into profile_row;
  else
    -- Another Tenant changes only its own membership, never global identity.
    update public.tenant_memberships as membership_row
    set
      role_id = preset_row.role_id,
      account_class = preset_row.account_class,
      company_id = null
    where membership_row.tenant_id = actor_tenant_id
      and membership_row.profile_id = p_profile_id
      and membership_row.archived_at is null;

    if found then
      select * into profile_row
      from public.profiles as existing
      where existing.id = p_profile_id;
    end if;
  end if;

  if profile_row.id is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  if p_profile_id <> actor_id then
    perform private.apply_profile_permission_overrides(
      p_profile_id,
      p_overrides
    );
  elsif jsonb_array_length(coalesce(p_overrides, '[]'::jsonb)) > 0 then
    raise exception 'permission overrides cannot be applied to your own account'
      using errcode = '42501';
  end if;

  if was_provisioned then
    perform private.record_authenticated_activity(
      'profile',
      profile_row.id,
      'account.member_created',
      format(
        'Provisioned a Wolf Forge member on the %s preset.',
        preset_row.key
      ),
      jsonb_build_object(
        'preset_key', preset_row.key,
        'account_class', preset_row.account_class,
        'override_count', jsonb_array_length(coalesce(p_overrides, '[]'::jsonb))
      )
    );
  end if;

  return profile_row;
end;
$$;

create or replace function public.app_assign_client_profile_to_company(p_profile_id uuid, p_company_id uuid, p_display_name text default null::text)
 returns public.profiles
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  profile_row public.profiles;
  normalized_display_name text := nullif(btrim(p_display_name), '');
  actor_tenant_id uuid := (select private.identity_tenant_id());
begin
  perform private.require_client_private_admin();
  perform private.require_permission('users.create');

  if not exists (
    select 1
    from public.companies as company_row
    where company_row.tenant_id = actor_tenant_id
      and company_row.id = p_company_id
      and company_row.archived_at is null
  ) then
    raise no_data_found;
  end if;

  if actor_tenant_id = private.wolf_forge_tenant_id() then
    -- Wolf Forge compatibility: the mirror carries the Client to the membership.
    update public.profiles as target_profile
    set
      company_id = p_company_id,
      display_name = coalesce(normalized_display_name, target_profile.display_name)
    from public.roles as target_role
    where target_profile.id = p_profile_id
      and target_profile.role_id = target_role.id
      and target_role.name = 'client'
      and target_profile.archived_at is null
    returning target_profile.* into profile_row;
  else
    -- Another Tenant changes only its own membership, never global identity.
    update public.tenant_memberships as membership_row
    set company_id = p_company_id
    from public.roles as target_role
    where membership_row.tenant_id = actor_tenant_id
      and membership_row.profile_id = p_profile_id
      and membership_row.role_id = target_role.id
      and target_role.name = 'client'
      and membership_row.archived_at is null;

    if found then
      select * into profile_row
      from public.profiles as existing
      where existing.id = p_profile_id;
    end if;
  end if;

  if profile_row.id is null then
    raise no_data_found;
  end if;

  perform private.record_authenticated_activity(
    'profile',
    profile_row.id,
    'profile.company_assigned',
    'Assigned a client portal profile to a company.',
    jsonb_build_object('company_id', p_company_id)
  );

  return profile_row;
end;
$$;

create or replace function public.app_provision_client_account_profile(p_profile_id uuid, p_company_id uuid, p_display_name text default null::text, p_overrides jsonb default '[]'::jsonb)
 returns public.profiles
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  profile_row public.profiles;
  preset_row public.permission_presets;
  already_linked boolean;
begin
  -- Reuses the existing audited client membership boundary rather than adding a
  -- competing client account creation path.
  perform private.require_client_private_admin();

  select * into preset_row
  from public.permission_presets as candidate
  where candidate.key = 'client';

  if private.profile_account_class(p_profile_id) <> 'client' then
    raise exception 'a client portal account requires the client preset'
      using errcode = '42501';
  end if;

  select (existing.company_id = p_company_id)
  into already_linked
  from public.tenant_memberships as existing
  where existing.tenant_id = (select private.identity_tenant_id())
    and existing.profile_id = p_profile_id;

  profile_row := public.app_assign_client_profile_to_company(
    p_profile_id,
    p_company_id,
    p_display_name
  );

  perform private.apply_profile_permission_overrides(
    p_profile_id,
    p_overrides
  );

  if already_linked is distinct from true then
    perform private.record_authenticated_activity(
      'profile',
      profile_row.id,
      'account.client_created',
      'Provisioned a client portal account.',
      jsonb_build_object(
        'preset_key', preset_row.key,
        'account_class', preset_row.account_class,
        'company_id', p_company_id,
        'override_count', jsonb_array_length(coalesce(p_overrides, '[]'::jsonb))
      )
    );
  end if;

  return profile_row;
end;
$$;
