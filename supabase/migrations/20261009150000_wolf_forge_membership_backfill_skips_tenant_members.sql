-- WL-2.30 (KI-144 review): the WL-1A Wolf Forge membership backfill claims only
-- unclaimed identities.
--
-- Before: private.backfill_wolf_forge_tenant_memberships() inserted a Wolf
-- Forge membership for every profile without one. It ran once in WL-1A, when
-- Wolf Forge was the only Tenant. Since D-275 an identity may belong only to
-- another Tenant, so re-running it would have pulled every Tenant-only
-- identity into Wolf Forge (a bulk KI-114 identity merge that bypasses the
-- mirror's 42501 refusal).
--
-- After: it skips any profile that already holds a membership in any Tenant,
-- the same rule private.mirror_profile_tenant_membership() applies. On a
-- database with only Wolf Forge the result is unchanged. EXECUTE stays
-- postgres-only; nothing calls it after WL-1A.

create or replace function private.backfill_wolf_forge_tenant_memberships()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with inserted as (
    insert into public.tenant_memberships (
      tenant_id, profile_id, account_class, role_id, company_id, archived_at
    )
    select
      private.wolf_forge_tenant_id(),
      profile_row.id,
      preset_row.account_class,
      profile_row.role_id,
      profile_row.company_id,
      profile_row.archived_at
    from public.profiles as profile_row
    left join public.permission_presets as preset_row
      on preset_row.role_id = profile_row.role_id
    where not exists (
      select 1 from public.tenant_memberships as membership_row
      where membership_row.profile_id = profile_row.id
    )
    on conflict (tenant_id, profile_id) do nothing
    returning 1
  )
  select count(*) from inserted;
$$;

revoke all on function private.backfill_wolf_forge_tenant_memberships() from public, anon, authenticated, service_role;
