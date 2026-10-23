-- WL-2.32 (KI-146 / D-296): Platform Admin authorization foundation.
--
-- Platform Admin is a GLOBAL platform entitlement, separate from every Tenant
-- role. Owner, admin, manager, staff and client are Tenant roles
-- (tenant_memberships) and never imply it; neither does profiles.role_id, a
-- Tenant selector, a header, or anything the browser sends. One identity may
-- hold a Platform Admin grant AND memberships in several Tenants; the
-- authorities stay distinct.
--
-- Model: private.platform_admins holds explicit grants with their history.
--   * Provisioning and revocation are postgres-only operations
--     (private.grant_platform_admin / private.revoke_platform_admin): no API
--     role, including service_role, can read or write the table or call them,
--     so no session, RPC or leaked service key can self-enrol.
--   * A grant is active while revoked_at is null; at most one active grant per
--     profile. Revocation keeps the row; a revoked row cannot be revived.
--   * A globally archived profile (profiles.archived_at) is never a Platform
--     Admin, whatever its grants say; archive suspends, it does not revoke.
--   * Grant history outlives revocation: a profile that ever held a grant
--     cannot be deleted until postgres deliberately removes its rows.
--
-- Checks resolve the caller ONLY from auth.uid():
--   * public.app_is_platform_admin()  — boolean for the server UI boundary;
--     EXECUTE for authenticated only.
--   * private.require_platform_admin() — raises 42501; the guard every future
--     Platform Admin mutation RPC must call first.
--
-- No grant is created here. Production bootstrap is a separate, explicit,
-- reviewed operation (run private.grant_platform_admin as postgres); local QA
-- uses a separate synthetic identity (scripts/qa-local-platform-admin.ts).

create table private.platform_admins (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  grant_reason text not null,
  revoked_at timestamptz,
  revoke_reason text,
  constraint platform_admins_grant_reason_not_blank check (btrim(grant_reason) <> ''),
  constraint platform_admins_revocation_complete check ((revoked_at is null) = (revoke_reason is null)),
  constraint platform_admins_revoke_reason_not_blank check (revoke_reason is null or btrim(revoke_reason) <> ''),
  constraint platform_admins_revoked_after_grant check (revoked_at is null or revoked_at >= granted_at)
);

create unique index platform_admins_one_active_grant
  on private.platform_admins (profile_id)
  where revoked_at is null;

alter table private.platform_admins enable row level security;

revoke all on table private.platform_admins from public, anon, authenticated, service_role;

-- A grant's identity and reason are immutable; the only change is a one-way
-- revocation, stamped with the real time. Deletes stay postgres-only.
create function private.platform_admins_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id is distinct from old.profile_id
    or new.granted_at is distinct from old.granted_at
    or new.grant_reason is distinct from old.grant_reason
    or old.revoked_at is not null then
    raise exception 'Platform Admin grants are immutable; only an active grant can be revoked'
      using errcode = '55000';
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

create trigger platform_admins_guard_update
  before update on private.platform_admins
  for each row execute function private.platform_admins_guard_update();

revoke all on function private.platform_admins_guard_update() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Checks (caller = auth.uid() only)
-- -----------------------------------------------------------------------------

create function private.current_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.platform_admins as grant_row
    join public.profiles as profile_row on profile_row.id = grant_row.profile_id
    where grant_row.profile_id = auth.uid()
      and grant_row.revoked_at is null
      and profile_row.archived_at is null
  );
$$;

create function public.app_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_platform_admin();
$$;

create function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_is_platform_admin() then
    raise exception 'Platform Admin authorization required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.current_user_is_platform_admin() from public, anon, authenticated, service_role;
revoke all on function private.require_platform_admin() from public, anon, authenticated, service_role;
revoke all on function public.app_is_platform_admin() from public, anon, authenticated, service_role;
grant execute on function public.app_is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Explicit privileged provisioning / revocation (postgres only)
-- -----------------------------------------------------------------------------

create function private.grant_platform_admin(p_profile_id uuid, p_reason text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not exists (
    select 1 from public.profiles where id = p_profile_id and archived_at is null
  ) then
    raise exception 'Platform Admin can only be granted to an existing, active profile'
      using errcode = '55000';
  end if;

  insert into private.platform_admins (profile_id, grant_reason)
  values (p_profile_id, p_reason)
  returning id into v_id;

  return v_id;
end;
$$;

create function private.revoke_platform_admin(p_profile_id uuid, p_reason text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
begin
  update private.platform_admins
  set revoked_at = now(), revoke_reason = p_reason
  where profile_id = p_profile_id and revoked_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'No active Platform Admin grant for this profile' using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

revoke all on function private.grant_platform_admin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_platform_admin(uuid, text) from public, anon, authenticated, service_role;
