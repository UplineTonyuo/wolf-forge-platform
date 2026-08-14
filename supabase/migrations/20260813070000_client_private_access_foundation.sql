-- Wolf Forge Platform
-- Client-private access foundation.
--
-- This migration intentionally does NOT change existing operational RLS.
--
-- Client-private access:
--   owner/admin -> allowed
--   manager/staff -> denied
--   client -> allowed only for own active company
--
-- These helpers are the authorization foundation for future:
--   client portal
--   private client wallet views
--   client-private documents/messages/settings
--   secure provisioning RPCs

-- ============================================================
-- CURRENT ROLE
-- ============================================================

create or replace function private.current_user_role_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role.name
  from public.profiles as profile
  join public.roles as role
    on role.id = profile.role_id
  where profile.id = (select auth.uid())
    and profile.archived_at is null
  limit 1;
$$;


-- ============================================================
-- AUTHORIZED CLIENT-PRIVATE ADMIN
--
-- owner/admin are privileged.
-- manager/staff are intentionally NOT included.
-- ============================================================

create or replace function private.is_client_private_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.current_user_role_name()
      in ('owner', 'admin'),
    false
  );
$$;


-- ============================================================
-- COMPANY-SCOPED CLIENT-PRIVATE ACCESS
--
-- Access is allowed when:
--
-- 1. current user is owner/admin
--
-- OR
--
-- 2. current user is a client whose profile.company_id
--    exactly matches the requested active company.
-- ============================================================

create or replace function private.can_access_client_private_company(
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_company_id is not null
    and exists (
      select 1
      from public.profiles as profile

      join public.roles as role
        on role.id = profile.role_id

      join public.companies as target_company
        on target_company.id = p_company_id
       and target_company.archived_at is null

      where profile.id = (select auth.uid())
        and profile.archived_at is null
        and (
          role.name in ('owner', 'admin')

          or (
            role.name = 'client'
            and profile.company_id = p_company_id
          )
        )
    );
$$;


-- ============================================================
-- REQUIRE AUTHORIZED ADMIN
--
-- For privileged mutations such as:
--   Add Client
--   Add Wolf Forge Member
--   future client-private administration
-- ============================================================

create or replace function private.require_client_private_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or not private.is_client_private_admin()
  then
    raise exception
      'authorized client administration is required'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;


-- ============================================================
-- REQUIRE COMPANY-SCOPED PRIVATE ACCESS
--
-- Useful inside future SECURITY DEFINER RPCs.
-- ============================================================

create or replace function private.require_client_private_company_access(
  p_company_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if p_company_id is null then
    raise exception
      'company id is required'
      using errcode = '22023';
  end if;

  if actor_id is null
    or not private.can_access_client_private_company(
      p_company_id
    )
  then
    raise exception
      'client-private company access is denied'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;


-- ============================================================
-- PRIVILEGES
-- ============================================================

revoke all on function
  private.current_user_role_name()
from public, anon, authenticated, service_role;

revoke all on function
  private.is_client_private_admin()
from public, anon, authenticated, service_role;

revoke all on function
  private.can_access_client_private_company(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  private.require_client_private_admin()
from public, anon, authenticated, service_role;

revoke all on function
  private.require_client_private_company_access(uuid)
from public, anon, authenticated, service_role;


-- Predicate helpers may be evaluated by authenticated RLS policies.

grant execute on function
  private.is_client_private_admin()
to authenticated;

grant execute on function
  private.can_access_client_private_company(uuid)
to authenticated;


comment on function private.is_client_private_admin()
is
  'True only for active Wolf Forge owner/admin profiles. Manager and staff roles are intentionally excluded from client-private access.';

comment on function private.can_access_client_private_company(uuid)
is
  'Allows active owner/admin profiles or an active client profile linked to the requested active company.';

comment on function private.require_client_private_admin()
is
  'Raises 42501 unless the authenticated actor is an active owner/admin profile.';

comment on function private.require_client_private_company_access(uuid)
is
  'Raises 42501 unless the authenticated actor may access client-private data for the requested company.';