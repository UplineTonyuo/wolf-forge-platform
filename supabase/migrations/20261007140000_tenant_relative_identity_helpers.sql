-- Wolf Forge Platform
-- White Label WL-1B Checkpoint B: Tenant-relative identity and permission
-- helpers.
--
-- The helpers below now read the caller's (or target's) public.tenant_memberships
-- row in the request Tenant instead of public.profiles. profiles stays the
-- compatibility source: the WL-1A mirror keeps the Wolf Forge membership equal
-- to it (role_id, company_id, archived_at) in the same transaction, so every
-- result for today's Wolf Forge users is unchanged. Each predicate is the old
-- one with the profile row swapped for the membership row.
--
-- WHO the caller is inside a Tenant only. Business rows have no tenant_id yet,
-- so this is not cross-Tenant data isolation (WL-1C / WL-2).
--
-- Signatures, owners, ACLs, SECURITY DEFINER and search_path are unchanged
-- (create or replace keeps them).

-- -----------------------------------------------------------------------------
-- Tenant used to evaluate a profile (Anthony decision, 2026-10-07)
-- -----------------------------------------------------------------------------

-- The profile_* helpers also evaluate OTHER profiles, and some callers run with
-- no signed-in user: service-role-only RPCs (client welcome email) and
-- notification triggers fired by service writes (invoice payment, wallet
-- credit). Those carry no x-wf-tenant header.
--
--   signed-in user  -> private.current_tenant_id() (selector + membership;
--                      foreign or invalid selector -> NULL, fails closed)
--   anon            -> NULL
--   no user, not anon (service_role, triggers, SQL jobs)
--                   -> Wolf Forge. A WL-1B compatibility bridge, to be replaced
--                      by an explicit trusted Tenant mechanism in WL-1C / WL-2.
--                      Browsers cannot reach it: a signed Supabase user JWT
--                      always carries `sub`, so it takes the first branch.
--
-- Not executable by any client role.
create function private.identity_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null
      then private.current_tenant_id()
    when (select auth.role()) is distinct from 'anon'
      then private.wolf_forge_tenant_id()
  end;
$$;

revoke all on function private.identity_tenant_id() from public, anon, authenticated, service_role;

comment on function private.identity_tenant_id()
is 'WL-1B: Tenant in which profile_* helpers evaluate a profile. Signed-in: current_tenant_id(); anon: NULL; no user (service role / triggers): Wolf Forge compatibility bridge until WL-1C/WL-2.';

-- -----------------------------------------------------------------------------
-- Profile helpers (any profile, evaluated in identity_tenant_id())
-- -----------------------------------------------------------------------------

create or replace function private.profile_account_class(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select preset_row.account_class
  from public.tenant_memberships as membership_row
  join public.permission_presets as preset_row
    on preset_row.role_id = membership_row.role_id
  where membership_row.tenant_id = (select private.identity_tenant_id())
    and membership_row.profile_id = p_profile_id
    and membership_row.archived_at is null;
$$;

create or replace function private.profile_permission_preset_key(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select preset_row.key
  from public.tenant_memberships as membership_row
  join public.permission_presets as preset_row
    on preset_row.role_id = membership_row.role_id
  where membership_row.tenant_id = (select private.identity_tenant_id())
    and membership_row.profile_id = p_profile_id
    and membership_row.archived_at is null;
$$;

-- Owner means Owner of THIS Tenant's membership only. Profile overrides are
-- keyed by profile, not membership, and were all granted inside Wolf Forge, so
-- they apply only to the Wolf Forge membership until they are re-keyed; another
-- Tenant uses its role preset alone.
create or replace function private.profile_has_permission(
  p_profile_id uuid,
  p_permission_key text
)
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
              where profile_override.profile_id = membership_row.profile_id
                and profile_override.permission_key = p_permission_key
                and membership_row.tenant_id = private.wolf_forge_tenant_id()
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

-- -----------------------------------------------------------------------------
-- Caller helpers (auth.uid() in private.current_tenant_id())
-- -----------------------------------------------------------------------------

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships as membership_row
    join public.roles as role on role.id = membership_row.role_id
    where membership_row.tenant_id = (select private.current_tenant_id())
      and membership_row.profile_id = (select auth.uid())
      and membership_row.archived_at is null
      and role.name in ('owner', 'admin', 'manager', 'staff')
  );
$$;

create or replace function private.is_client_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships as membership_row
    join public.roles as role on role.id = membership_row.role_id
    where membership_row.tenant_id = (select private.current_tenant_id())
      and membership_row.profile_id = (select auth.uid())
      and membership_row.archived_at is null
      and role.name = 'client'
  );
$$;

create or replace function private.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership_row.company_id
  from public.tenant_memberships as membership_row
  join public.roles as role on role.id = membership_row.role_id
  join public.companies as company on company.id = membership_row.company_id
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null
    and company.archived_at is null
    and role.name = 'client';
$$;

create or replace function private.current_user_role_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role.name
  from public.tenant_memberships as membership_row
  join public.roles as role
    on role.id = membership_row.role_id
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null
  limit 1;
$$;

create or replace function private.current_store_client()
returns table(profile_id uuid, company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select membership_row.profile_id, company_row.id
  from public.tenant_memberships as membership_row
  join public.roles as role_row
    on role_row.id = membership_row.role_id
  join public.companies as company_row
    on company_row.id = membership_row.company_id
   and company_row.archived_at is null
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null
    and role_row.name = 'client';
$$;

create or replace function private.current_ticket_actor()
returns table(profile_id uuid, role_name text, company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select membership_row.profile_id, role_row.name, membership_row.company_id
  from public.tenant_memberships as membership_row
  join public.roles as role_row on role_row.id = membership_row.role_id
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null;
$$;
