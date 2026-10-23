-- Wolf Forge Platform
-- White Label WL-1A: Tenant and Tenant Membership foundation.
--
-- A Tenant is a SaaS workspace / white-label customer. It is not a Company
-- (public.organizations) and not a Client record (public.companies).
--
-- During WL-1A public.profiles stays the source of truth for role, Client and
-- archive state. public.tenant_memberships is an exact, one-way compatibility
-- mirror of it inside the single Wolf Forge Tenant. The mirror is maintained in
-- the same transaction as the profile write: if it cannot be maintained, the
-- profile write fails. Nothing reads these tables yet.
--
-- Additive only: no existing row, column, policy, grant or function is changed.
-- The one attachment to an existing table is the AFTER mirror trigger on
-- public.profiles; it writes only to public.tenant_memberships.

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tenants_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 63),
  constraint tenants_display_name_valid
    check (btrim(display_name) <> '' and char_length(display_name) <= 200),
  constraint tenants_status_valid
    check (status in ('active', 'suspended', 'archived')),
  constraint tenants_archive_consistent
    check ((status = 'archived') = (archived_at is not null))
);

create trigger tenants_set_updated_at
before update on public.tenants
for each row
execute function private.set_updated_at();

-- The one canonical source for Tenant #1. Later compatibility phases reference
-- this function instead of repeating the literal.
create function private.wolf_forge_tenant_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select 'f0f0f0f0-0000-4000-8000-000000000001'::uuid;
$$;

insert into public.tenants (id, slug, display_name, status)
values (private.wolf_forge_tenant_id(), 'wolf-forge', 'Wolf Forge', 'active');

-- Same shape as private.protect_system_permission_preset: the system Tenant
-- cannot be deleted by accident.
create function private.protect_wolf_forge_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.id = private.wolf_forge_tenant_id() then
    raise exception 'the Wolf Forge system tenant cannot be deleted'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

create trigger tenants_protect_wolf_forge
before delete on public.tenants
for each row
execute function private.protect_wolf_forge_tenant();

-- -----------------------------------------------------------------------------
-- Tenant memberships
-- -----------------------------------------------------------------------------

-- company_id follows profiles.company_id exactly, including its ON DELETE SET
-- NULL, so deleting a Client behaves as it does today. The composite Tenant FK
-- to companies arrives in WL-1C, once companies carries tenant_id.
--
-- Deferred invariant (WL-1C): "company_id only for client memberships" is NOT
-- enforced here. An internal profile may legally hold a company_id today
-- (pgTAP 006, service_role administration), and an exact, fail-closed mirror
-- must accept every valid profile state. Enforce it only when memberships
-- become authoritative, after a read-only Production count of internal
-- profiles with a company_id is 0; otherwise design an explicit data migration.
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  account_class text not null,
  role_id uuid not null references public.roles (id) on delete restrict,
  company_id uuid references public.companies (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tenant_memberships_tenant_profile_key unique (tenant_id, profile_id),
  constraint tenant_memberships_account_class_valid
    check (account_class in ('internal', 'client'))
);

create index tenant_memberships_profile_id_idx
on public.tenant_memberships (profile_id);

create index tenant_memberships_company_id_idx
on public.tenant_memberships (company_id)
where company_id is not null;

create trigger tenant_memberships_set_updated_at
before update on public.tenant_memberships
for each row
execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Backfill and profile -> membership mirror
-- -----------------------------------------------------------------------------

-- Set-based and idempotent. A role without a permission preset has no account
-- class, so the NOT NULL constraint refuses it rather than guessing one.
create function private.backfill_wolf_forge_tenant_memberships()
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
    on conflict (tenant_id, profile_id) do nothing
    returning 1
  )
  select count(*) from inserted;
$$;

select private.backfill_wolf_forge_tenant_memberships();

-- Fail closed: any error here (no preset for the role, any membership
-- constraint violation) aborts the originating profile write. Nothing
-- is caught, so profiles and memberships can never disagree.
create function private.mirror_profile_tenant_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mirrored_class text;
begin
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

create trigger profiles_mirror_tenant_membership
after insert or update of role_id, company_id, archived_at on public.profiles
for each row
execute function private.mirror_profile_tenant_membership();

-- -----------------------------------------------------------------------------
-- Access: not an application surface yet
-- -----------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_memberships force row level security;

revoke all on table public.tenants from public, anon, authenticated, service_role;
revoke all on table public.tenant_memberships from public, anon, authenticated, service_role;

revoke all on function private.wolf_forge_tenant_id() from public, anon, authenticated, service_role;
revoke all on function private.protect_wolf_forge_tenant() from public, anon, authenticated, service_role;
revoke all on function private.backfill_wolf_forge_tenant_memberships() from public, anon, authenticated, service_role;
revoke all on function private.mirror_profile_tenant_membership() from public, anon, authenticated, service_role;

comment on table public.tenants
is 'SaaS workspace / white-label customer. Not a Company and not a Client. WL-1A: Wolf Forge is the only Tenant.';
comment on table public.tenant_memberships
is 'WL-1A: exact one-way mirror of public.profiles inside the Wolf Forge Tenant, maintained transactionally by profiles_mirror_tenant_membership.';
comment on function private.wolf_forge_tenant_id()
is 'Fixed id of Tenant #1 (Wolf Forge). The single canonical reference for later compatibility phases.';
comment on function private.mirror_profile_tenant_membership()
is 'Fail-closed profile -> Wolf Forge membership mirror. Errors are never suppressed; the profile write fails instead.';
