-- Wolf Forge Platform - Phase 1 core schema
-- This migration intentionally contains only the initial operational data model.

-- -----------------------------------------------------------------------------
-- Schemas and shared functions
-- -----------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_name_not_blank check (btrim(name) <> '')
);

insert into public.roles (name)
values
  ('owner'),
  ('admin'),
  ('manager'),
  ('staff'),
  ('client');

create trigger roles_set_updated_at
before update on public.roles
for each row
execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Companies
-- -----------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint companies_name_not_blank check (btrim(name) <> '')
);

create index companies_active_name_idx
on public.companies (name)
where archived_at is null;

create trigger companies_set_updated_at
before update on public.companies
for each row
execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  company_id uuid references public.companies (id) on delete set null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint profiles_display_name_not_blank
    check (display_name is null or btrim(display_name) <> '')
);

create index profiles_role_id_idx on public.profiles (role_id);
create index profiles_company_id_idx
on public.profiles (company_id)
where company_id is not null;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_updated_at();

-- Authorization helpers are SECURITY DEFINER so their lookups do not recurse
-- through profiles RLS. All referenced objects are schema-qualified.
create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id
    where profile.id = (select auth.uid())
      and profile.archived_at is null
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
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id
    where profile.id = (select auth.uid())
      and profile.archived_at is null
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
  select profile.company_id
  from public.profiles as profile
  join public.roles as role on role.id = profile.role_id
  join public.companies as company on company.id = profile.company_id
  where profile.id = (select auth.uid())
    and profile.archived_at is null
    and company.archived_at is null
    and role.name = 'client';
$$;

-- Auth metadata is deliberately not consulted. Every automatically-created
-- profile receives the client role from the database-controlled roles table.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_role_id uuid;
begin
  select role.id
  into strict client_role_id
  from public.roles as role
  where role.name = 'client';

  insert into public.profiles (id, role_id)
  values (new.id, client_role_id);

  return new;
end;
$$;

create trigger auth_users_create_profile
after insert on auth.users
for each row
execute function private.handle_new_auth_user();

-- Reused by orders and tasks so client profiles cannot be selected as
-- operational assignees.
create or replace function private.require_internal_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to_profile_id is not null
    and not exists (
      select 1
      from public.profiles as profile
      join public.roles as role on role.id = profile.role_id
      where profile.id = new.assigned_to_profile_id
        and profile.archived_at is null
        and role.name in ('owner', 'admin', 'manager', 'staff')
    )
  then
    raise exception 'assignee must be an active internal profile'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client contacts
-- -----------------------------------------------------------------------------

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text,
  phone text,
  job_title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint client_contacts_name_not_blank check (btrim(name) <> ''),
  constraint client_contacts_email_not_blank
    check (email is null or btrim(email) <> ''),
  constraint client_contacts_phone_not_blank
    check (phone is null or btrim(phone) <> ''),
  constraint client_contacts_job_title_not_blank
    check (job_title is null or btrim(job_title) <> '')
);

create index client_contacts_company_id_idx
on public.client_contacts (company_id);

create unique index client_contacts_active_profile_id_key
on public.client_contacts (profile_id)
where profile_id is not null and archived_at is null;

create index client_contacts_profile_id_idx
on public.client_contacts (profile_id)
where profile_id is not null;

create unique index client_contacts_one_active_primary_per_company_key
on public.client_contacts (company_id)
where is_primary and archived_at is null;

create trigger client_contacts_set_updated_at
before update on public.client_contacts
for each row
execute function private.set_updated_at();

-- A linked portal profile must remain a client of the same company. The
-- companion profiles trigger prevents later profile administration from
-- invalidating an existing contact link.
create or replace function private.require_client_contact_profile_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is not null
    and not exists (
      select 1
      from public.profiles as profile
      join public.roles as role on role.id = profile.role_id
      where profile.id = new.profile_id
        and profile.company_id = new.company_id
        and role.name = 'client'
    )
  then
    raise exception 'linked contact profile must be a client in the same company'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.protect_linked_contact_profile_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.client_contacts as contact
    where contact.profile_id = new.id
      and (
        new.company_id is distinct from contact.company_id
        or not exists (
          select 1
          from public.roles as role
          where role.id = new.role_id
            and role.name = 'client'
        )
      )
  )
  then
    raise exception 'linked contact profile must remain a client in the same company'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger client_contacts_require_profile_consistency
before insert or update of company_id, profile_id on public.client_contacts
for each row
execute function private.require_client_contact_profile_consistency();

create trigger profiles_protect_linked_contact_consistency
before update of role_id, company_id on public.profiles
for each row
execute function private.protect_linked_contact_profile_consistency();

-- -----------------------------------------------------------------------------
-- Services
-- -----------------------------------------------------------------------------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint services_name_not_blank check (btrim(name) <> ''),
  constraint services_description_not_blank
    check (description is null or btrim(description) <> '')
);

create index services_active_name_idx
on public.services (name)
where is_active and archived_at is null;

create trigger services_set_updated_at
before update on public.services
for each row
execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  company_id uuid not null references public.companies (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  assigned_to_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint orders_title_not_blank check (btrim(title) <> ''),
  constraint orders_status_valid check (
    status in (
      'pending',
      'submitted',
      'working',
      'waiting_reply',
      'pending_update',
      'complete',
      'canceled'
    )
  ),
  constraint orders_priority_valid check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  constraint orders_dates_valid check (
    completed_at is null
    or started_at is null
    or completed_at >= started_at
  ),
  constraint orders_completion_consistent check (
    (status = 'complete') = (completed_at is not null)
  )
);

create index orders_company_id_idx on public.orders (company_id);
create index orders_service_id_idx on public.orders (service_id);
create index orders_assigned_to_profile_id_idx
on public.orders (assigned_to_profile_id)
where assigned_to_profile_id is not null;
create index orders_active_company_status_created_at_idx
on public.orders (company_id, status, created_at desc)
where archived_at is null;
create index orders_active_assignee_status_idx
on public.orders (assigned_to_profile_id, status)
where assigned_to_profile_id is not null and archived_at is null;

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function private.set_updated_at();

create trigger orders_require_internal_assignee
before insert or update of assigned_to_profile_id on public.orders
for each row
execute function private.require_internal_assignee();

-- -----------------------------------------------------------------------------
-- Order tasks
-- -----------------------------------------------------------------------------

create table public.order_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  assigned_to_profile_id uuid references public.profiles (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo',
  due_at timestamptz,
  sort_position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint order_tasks_title_not_blank check (btrim(title) <> ''),
  constraint order_tasks_description_not_blank
    check (description is null or btrim(description) <> ''),
  constraint order_tasks_status_valid check (
    status in ('todo', 'in_progress', 'blocked', 'complete', 'canceled')
  ),
  constraint order_tasks_sort_position_nonnegative check (sort_position >= 0),
  constraint order_tasks_completion_consistent check (
    (status = 'complete') = (completed_at is not null)
  )
);

create index order_tasks_order_id_idx on public.order_tasks (order_id);
create index order_tasks_assigned_to_profile_id_idx
on public.order_tasks (assigned_to_profile_id)
where assigned_to_profile_id is not null;
create index order_tasks_active_order_position_idx
on public.order_tasks (order_id, sort_position)
where archived_at is null;

create trigger order_tasks_set_updated_at
before update on public.order_tasks
for each row
execute function private.set_updated_at();

create trigger order_tasks_require_internal_assignee
before insert or update of assigned_to_profile_id on public.order_tasks
for each row
execute function private.require_internal_assignee();

-- -----------------------------------------------------------------------------
-- Activity events
-- -----------------------------------------------------------------------------

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_events_entity_type_not_blank
    check (btrim(entity_type) <> ''),
  constraint activity_events_entity_type_valid check (
    entity_type in (
      'company',
      'client_contact',
      'service',
      'order',
      'order_task',
      'profile'
    )
  ),
  constraint activity_events_action_not_blank check (btrim(action) <> ''),
  constraint activity_events_summary_not_blank check (btrim(summary) <> ''),
  constraint activity_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create index activity_events_actor_profile_id_created_at_idx
on public.activity_events (actor_profile_id, created_at desc)
where actor_profile_id is not null;

create index activity_events_entity_created_at_idx
on public.activity_events (entity_type, entity_id, created_at desc);

create index activity_events_created_at_idx
on public.activity_events (created_at desc);

-- Authenticated application inserts cannot forge actor identity or event time.
-- service_role is deliberately left unchanged for trusted backend/system logs.
create or replace function private.normalize_authenticated_activity_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.actor_profile_id = (select auth.uid());
    new.created_at = now();
  end if;

  return new;
end;
$$;

create or replace function private.prevent_activity_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Preserve the actor FK's declared ON DELETE SET NULL behavior. A direct
  -- update has trigger depth 1; the referential action invokes this trigger at
  -- a nested depth and may change only actor_profile_id to null.
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and old.actor_profile_id is not null
    and new.actor_profile_id is null
    and (to_jsonb(new) - 'actor_profile_id')
      = (to_jsonb(old) - 'actor_profile_id')
  then
    return new;
  end if;

  raise exception 'activity events are append-only'
    using errcode = '55000';
end;
$$;

create trigger activity_events_normalize_authenticated_insert
before insert on public.activity_events
for each row
execute function private.normalize_authenticated_activity_event();

create trigger activity_events_prevent_mutation
before update or delete on public.activity_events
for each row
execute function private.prevent_activity_event_mutation();

-- TRUNCATE bypasses row-level triggers, so append-only protection also needs a
-- statement-level guard. Local db reset recreates the database and is not
-- impeded by this trigger.
create trigger activity_events_prevent_truncate
before truncate on public.activity_events
for each statement
execute function private.prevent_activity_event_mutation();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.roles enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.client_contacts enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.order_tasks enable row level security;
alter table public.activity_events enable row level security;

-- Roles are controlled reference data. Internal users may read them, but no
-- application role receives write or delete access.
create policy roles_internal_select
on public.roles
for select
to authenticated
using ((select private.is_internal_user()));

-- Companies
create policy companies_internal_select
on public.companies
for select
to authenticated
using ((select private.is_internal_user()));

create policy companies_internal_insert
on public.companies
for insert
to authenticated
with check ((select private.is_internal_user()));

create policy companies_internal_update
on public.companies
for update
to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy companies_client_select_own
on public.companies
for select
to authenticated
using (
  (select private.is_client_user())
  and id = (select private.current_user_company_id())
  and archived_at is null
);

-- Profiles are created by the auth trigger. Internal users may read profiles;
-- each active client may read only their own profile.
create policy profiles_internal_select
on public.profiles
for select
to authenticated
using ((select private.is_internal_user()));

create policy profiles_client_select_own
on public.profiles
for select
to authenticated
using (
  (select private.is_client_user())
  and id = (select auth.uid())
  and archived_at is null
);

-- Client contacts remain operational-only in Phase 1.
create policy client_contacts_internal_select
on public.client_contacts
for select
to authenticated
using ((select private.is_internal_user()));

create policy client_contacts_internal_insert
on public.client_contacts
for insert
to authenticated
with check ((select private.is_internal_user()));

create policy client_contacts_internal_update
on public.client_contacts
for update
to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

-- Authenticated users may read only active, non-archived services. Internal
-- users additionally retain visibility into inactive and archived services.
create policy services_authenticated_select_active
on public.services
for select
to authenticated
using (is_active and archived_at is null);

create policy services_internal_select
on public.services
for select
to authenticated
using ((select private.is_internal_user()));

create policy services_internal_insert
on public.services
for insert
to authenticated
with check ((select private.is_internal_user()));

create policy services_internal_update
on public.services
for update
to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

-- Orders
create policy orders_internal_select
on public.orders
for select
to authenticated
using ((select private.is_internal_user()));

create policy orders_internal_insert
on public.orders
for insert
to authenticated
with check ((select private.is_internal_user()));

create policy orders_internal_update
on public.orders
for update
to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy orders_client_select_own_company
on public.orders
for select
to authenticated
using (
  (select private.is_client_user())
  and company_id = (select private.current_user_company_id())
  and archived_at is null
);

-- Order tasks
create policy order_tasks_internal_select
on public.order_tasks
for select
to authenticated
using ((select private.is_internal_user()));

create policy order_tasks_internal_insert
on public.order_tasks
for insert
to authenticated
with check ((select private.is_internal_user()));

create policy order_tasks_internal_update
on public.order_tasks
for update
to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy order_tasks_client_select_own_company
on public.order_tasks
for select
to authenticated
using (
  (select private.is_client_user())
  and exists (
    select 1
    from public.orders as parent_order
    where parent_order.id = order_tasks.order_id
      and parent_order.company_id = (select private.current_user_company_id())
      and parent_order.archived_at is null
  )
  and archived_at is null
);

-- Activity events are append-only through application roles.
create policy activity_events_internal_select
on public.activity_events
for select
to authenticated
using ((select private.is_internal_user()));

create policy activity_events_internal_insert
on public.activity_events
for insert
to authenticated
with check ((select private.is_internal_user()));

-- -----------------------------------------------------------------------------
-- Application privileges
-- -----------------------------------------------------------------------------

revoke all on table
  public.roles,
  public.companies,
  public.profiles,
  public.client_contacts,
  public.services,
  public.orders,
  public.order_tasks,
  public.activity_events
from anon, authenticated, service_role;

revoke all on sequence public.orders_order_number_seq
from anon, authenticated, service_role;

grant select on table public.roles, public.profiles to authenticated;

grant select, insert, update on table
  public.companies,
  public.client_contacts,
  public.services,
  public.orders,
  public.order_tasks
to authenticated;

grant select, insert on table public.activity_events to authenticated;

grant select on table public.roles to service_role;
grant select, update on table public.profiles to service_role;
grant select, insert, update on table
  public.companies,
  public.client_contacts,
  public.services,
  public.orders,
  public.order_tasks
to service_role;
grant select, insert on table public.activity_events to service_role;

-- Identity generation does not require direct API-role access to the owned
-- sequence. The explicit revocation above prevents nextval/currval/setval use.

revoke all on function private.set_updated_at() from public;
revoke all on function private.is_internal_user() from public;
revoke all on function private.is_client_user() from public;
revoke all on function private.current_user_company_id() from public;
revoke all on function private.handle_new_auth_user() from public;
revoke all on function private.require_internal_assignee() from public;
revoke all on function private.require_client_contact_profile_consistency() from public;
revoke all on function private.protect_linked_contact_profile_consistency() from public;
revoke all on function private.normalize_authenticated_activity_event() from public;
revoke all on function private.prevent_activity_event_mutation() from public;

grant usage on schema private to authenticated;
grant execute on function private.is_internal_user() to authenticated;
grant execute on function private.is_client_user() to authenticated;
grant execute on function private.current_user_company_id() to authenticated;
