-- WL-2.15 (D-275, KI-114, KI-118 item 1): Tenant membership is created only by
-- an explicit, Tenant-specific provisioning path.
--
-- Before: private.handle_new_auth_user creates a client-role profile, and the
-- WL-1A mirror (profiles_mirror_tenant_membership, AFTER INSERT OR UPDATE)
-- turned every new profile into an active Wolf Forge client membership. A
-- Wolf Forge admin could therefore provision or rename a Tenant B-only user
-- through the Wolf Forge branch of app_provision_internal_member_profile /
-- app_assign_client_profile_to_company (KI-114).
--
-- After:
--   * auth user -> global profile, and NO Tenant membership by default. The
--     mirror no longer fires on INSERT.
--   * profiles.role_id / company_id stay Wolf Forge compatibility fields
--     (D-274). Writing them is the explicit Wolf Forge compatibility path: the
--     mirror keeps an existing Wolf Forge membership in step, claims an
--     unclaimed identity (no membership in any Tenant) for Wolf Forge, and
--     refuses (42501) a profile that belongs only to other Tenants, so no
--     caller can pull a Tenant B identity into Wolf Forge through those fields.
--   * The provisioning RPCs claim only an identity that is already a member of
--     the caller's Tenant or holds no membership anywhere (a freshly created
--     auth user). Any other target reads as missing, exactly like before. In
--     the Wolf Forge Tenant the claim goes through the profile fields and the
--     mirror; in any other Tenant the RPC inserts that Tenant's membership row
--     and never writes the profile.
--   * The Tenant is always the caller's resolved Tenant
--     (private.identity_tenant_id(), membership-authorized); no RPC takes a
--     tenant_id. Adding an identity that already belongs to another Tenant is
--     a future explicit invite flow and is refused here.
--   * app_list_onboarding_assignment_candidates feeds the Forms onboarding
--     pickers from current-Tenant client memberships, with the same eligibility
--     app_assign_form enforces, instead of global profiles.role_id/company_id.
--
-- Existing memberships are not touched; no backfill or deletion.

create or replace function private.mirror_profile_tenant_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mirrored_class text;
begin
  if not exists (
    select 1
    from public.tenant_memberships as existing
    where existing.tenant_id = private.wolf_forge_tenant_id()
      and existing.profile_id = new.id
  ) then
    -- Without a Wolf Forge membership only a role or Client write is a Wolf
    -- Forge provisioning act; an archive-only change has nothing to mirror.
    if new.role_id is not distinct from old.role_id
      and new.company_id is not distinct from old.company_id
    then
      return null;
    end if;

    if exists (
      select 1
      from public.tenant_memberships as other
      where other.profile_id = new.id
    ) then
      raise exception 'this profile belongs to another Tenant; Wolf Forge compatibility fields cannot claim it'
        using errcode = '42501';
    end if;
  end if;

  select preset_row.account_class
  into mirrored_class
  from public.permission_presets as preset_row
  where preset_row.role_id = new.role_id;

  if mirrored_class is null then
    raise exception 'profile role has no permission preset; tenant membership cannot be mirrored'
      using errcode = '23514';
  end if;

  insert into public.tenant_memberships (
    tenant_id, profile_id, account_class, role_id, company_id, archived_at
  )
  values (
    private.wolf_forge_tenant_id(),
    new.id,
    mirrored_class,
    new.role_id,
    new.company_id,
    new.archived_at
  )
  on conflict (tenant_id, profile_id) do update
  set account_class = excluded.account_class,
      role_id = excluded.role_id,
      company_id = excluded.company_id,
      archived_at = excluded.archived_at;

  return null;
end;
$$;

drop trigger profiles_mirror_tenant_membership on public.profiles;

create trigger profiles_mirror_tenant_membership
after update of role_id, company_id, archived_at on public.profiles
for each row
execute function private.mirror_profile_tenant_membership();

comment on table public.tenant_memberships
is 'Explicit participation of a global profile in one Tenant. Created only by Tenant-specific provisioning (D-275); the Wolf Forge membership follows the profiles.role_id / company_id compatibility fields.';
comment on function private.mirror_profile_tenant_membership()
is 'Wolf Forge compatibility: profiles.role_id / company_id / archived_at -> the Wolf Forge membership. Claims only an identity with no membership anywhere; refuses one that belongs only to other Tenants. Not fired by profile creation (D-275).';

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
    -- A freshly created auth user holds no membership in any Tenant (D-275)
    -- and is claimed below. An identity that belongs to any Tenant, including
    -- an archived membership here, is not this caller's to claim.
    if exists (
      select 1
      from public.tenant_memberships as candidate
      where candidate.profile_id = p_profile_id
    ) then
      raise exception 'target profile was not found'
        using errcode = '42501';
    end if;

    was_provisioned := true;
  elsif existing_class = 'client' then
    -- An unlinked client membership of this Tenant may still become internal.
    -- Both checks read the current Tenant's membership and contacts.
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
  elsif existing_class is null then
    -- Another Tenant creates only its own membership, never global identity.
    insert into public.tenant_memberships (
      tenant_id, profile_id, account_class, role_id, company_id
    )
    select actor_tenant_id, target_profile.id, preset_row.account_class, preset_row.role_id, null
    from public.profiles as target_profile
    where target_profile.id = p_profile_id
      and target_profile.archived_at is null;

    if found then
      select * into profile_row
      from public.profiles as existing
      where existing.id = p_profile_id;
    end if;
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
  is_member boolean;
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

  -- The target is a member of the caller's Tenant, or a fresh identity with no
  -- membership in any Tenant (D-275). Anything else reads as missing.
  is_member := exists (
    select 1
    from public.tenant_memberships as candidate
    where candidate.tenant_id = actor_tenant_id
      and candidate.profile_id = p_profile_id
  );

  if not is_member and exists (
    select 1
    from public.tenant_memberships as candidate
    where candidate.profile_id = p_profile_id
  ) then
    raise no_data_found;
  end if;

  if actor_tenant_id = private.wolf_forge_tenant_id() then
    -- Wolf Forge compatibility: the mirror carries the Client to the membership
    -- and claims a fresh identity.
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
  elsif not is_member then
    -- Another Tenant creates only its own membership, never global identity.
    insert into public.tenant_memberships (
      tenant_id, profile_id, account_class, role_id, company_id
    )
    select actor_tenant_id, target_profile.id, 'client', target_role.id, p_company_id
    from public.profiles as target_profile
    cross join public.roles as target_role
    where target_profile.id = p_profile_id
      and target_profile.archived_at is null
      and target_role.name = 'client';

    if found then
      select * into profile_row
      from public.profiles as existing
      where existing.id = p_profile_id;
    end if;
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

-- Same eligibility app_assign_form's onboarding branch enforces: an active
-- client membership of the current Tenant, linked to an active Client of that
-- Tenant, on a non-archived profile.
create function public.app_list_onboarding_assignment_candidates(p_company_id uuid default null)
returns table (profile_id uuid, display_name text, company_id uuid, company_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_form_capability('forms.assign');

  return query
  select profile_row.id, profile_row.display_name, company_row.id, company_row.name
  from public.tenant_memberships as membership_row
  join public.roles as role_row
    on role_row.id = membership_row.role_id and role_row.name = 'client'
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id and profile_row.archived_at is null
  join public.companies as company_row
    on company_row.tenant_id = membership_row.tenant_id
   and company_row.id = membership_row.company_id
   and company_row.archived_at is null
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.archived_at is null
    and (p_company_id is null or membership_row.company_id = p_company_id)
  order by profile_row.display_name, profile_row.id;
end;
$$;

revoke all on function public.app_list_onboarding_assignment_candidates(uuid) from public, anon, service_role;
grant execute on function public.app_list_onboarding_assignment_candidates(uuid) to authenticated;
