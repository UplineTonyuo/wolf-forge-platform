-- ============================================================
-- WOLF FORGE ROLES & PERMISSIONS FOUNDATION
--
-- Phase 1 only.
--
-- Adds:
--   permissions
--   role_permissions
--   profile_permission_overrides
--   private permission resolver
--   public safe permission RPCs
--
-- Does NOT alter:
--   login routing
--   current navigation
--   client-private company scoping
--   account provisioning
-- ============================================================


-- ============================================================
-- PERMISSION CATALOG
-- ============================================================

create table public.permissions (
  permission_key text primary key,
  category text not null,
  label text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint permissions_key_format_check
    check (
      permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
    )
);


-- ============================================================
-- ROLE DEFAULTS
-- ============================================================

create table public.role_permissions (
  role_id uuid not null
    references public.roles(id)
    on delete cascade,

  permission_key text not null
    references public.permissions(permission_key)
    on delete cascade,

  allowed boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (
    role_id,
    permission_key
  )
);


-- ============================================================
-- PER-USER OVERRIDES
--
-- allowed = true
--   explicitly grant permission
--
-- allowed = false
--   explicitly deny permission even when role grants it
-- ============================================================

create table public.profile_permission_overrides (
  profile_id uuid not null
    references public.profiles(id)
    on delete cascade,

  permission_key text not null
    references public.permissions(permission_key)
    on delete cascade,

  allowed boolean not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (
    profile_id,
    permission_key
  )
);


-- ============================================================
-- RLS / DIRECT ACCESS BOUNDARY
--
-- Permission configuration is not directly editable through
-- ordinary authenticated table access.
--
-- Future admin UI writes will go through controlled RPCs.
-- ============================================================

alter table public.permissions
  enable row level security;

alter table public.role_permissions
  enable row level security;

alter table public.profile_permission_overrides
  enable row level security;


revoke all
on table public.permissions
from public;

revoke all
on table public.permissions
from anon, authenticated;


revoke all
on table public.role_permissions
from public;

revoke all
on table public.role_permissions
from anon, authenticated;


revoke all
on table public.profile_permission_overrides
from public;

revoke all
on table public.profile_permission_overrides
from anon, authenticated;


-- ============================================================
-- PERMISSION CATALOG
-- ============================================================

insert into public.permissions (
  permission_key,
  category,
  label,
  description
)
values

  (
    'dashboard.view',
    'dashboard',
    'View dashboard',
    'View the dashboard available to the current account.'
  ),

  (
    'projects.view',
    'projects',
    'View projects',
    'View projects within the account data scope.'
  ),
  (
    'projects.create',
    'projects',
    'Create projects',
    'Create new projects.'
  ),
  (
    'projects.edit',
    'projects',
    'Edit projects',
    'Edit permitted projects.'
  ),
  (
    'projects.assign',
    'projects',
    'Assign projects',
    'Assign permitted projects to team members.'
  ),
  (
    'projects.archive',
    'projects',
    'Archive projects',
    'Archive permitted projects.'
  ),

  (
    'tickets.view',
    'tickets',
    'View tickets',
    'View tickets within the account data scope.'
  ),
  (
    'tickets.create',
    'tickets',
    'Create tickets',
    'Create new tickets.'
  ),
  (
    'tickets.edit',
    'tickets',
    'Edit tickets',
    'Edit permitted tickets.'
  ),
  (
    'tickets.assign',
    'tickets',
    'Assign tickets',
    'Assign permitted tickets.'
  ),
  (
    'tickets.archive',
    'tickets',
    'Archive tickets',
    'Archive permitted tickets.'
  ),

  (
    'clients.view',
    'clients',
    'View clients',
    'View the internal client directory where permitted.'
  ),
  (
    'clients.create',
    'clients',
    'Create clients',
    'Create client records.'
  ),
  (
    'clients.edit',
    'clients',
    'Edit clients',
    'Edit permitted client records.'
  ),
  (
    'clients.archive',
    'clients',
    'Archive clients',
    'Archive permitted client records.'
  ),

  (
    'todo.view',
    'todo',
    'View to-do',
    'View permitted to-do items.'
  ),
  (
    'todo.manage',
    'todo',
    'Manage to-do',
    'Create and manage permitted to-do items.'
  ),

  (
    'invoices.view',
    'billing',
    'View invoices',
    'View invoices within the account data scope.'
  ),
  (
    'invoices.manage',
    'billing',
    'Manage invoices',
    'Create, edit, charge, or otherwise manage permitted invoices.'
  ),

  (
    'subscriptions.view',
    'billing',
    'View subscriptions',
    'View subscriptions within the account data scope.'
  ),
  (
    'subscriptions.manage',
    'billing',
    'Manage subscriptions',
    'Create and manage permitted subscriptions.'
  ),

  (
    'coupons.view',
    'marketing',
    'View coupons',
    'View coupons.'
  ),
  (
    'coupons.manage',
    'marketing',
    'Manage coupons',
    'Create, edit, and archive coupons.'
  ),

  (
    'services.view',
    'services',
    'View services',
    'View the service catalog.'
  ),
  (
    'services.create',
    'services',
    'Create services',
    'Create catalog services.'
  ),
  (
    'services.edit',
    'services',
    'Edit services',
    'Edit catalog services.'
  ),
  (
    'services.archive',
    'services',
    'Archive services',
    'Archive catalog services.'
  ),

  (
    'forms.view',
    'forms',
    'View forms',
    'View forms.'
  ),
  (
    'forms.manage',
    'forms',
    'Manage forms',
    'Create and manage forms.'
  ),

  (
    'settings.view',
    'settings',
    'View settings',
    'Access Wolf Forge settings.'
  ),

  (
    'users.view',
    'users',
    'View team',
    'View users and team members.'
  ),
  (
    'users.create',
    'users',
    'Create users',
    'Provision user accounts.'
  ),
  (
    'users.edit',
    'users',
    'Edit users',
    'Edit user account configuration.'
  ),
  (
    'users.manage_permissions',
    'users',
    'Manage permissions',
    'Assign roles and permission overrides.'
  );


-- ============================================================
-- OWNER + ADMIN DEFAULTS
--
-- Owner also receives an automatic permission resolver bypass
-- for every registered permission.
--
-- Admin receives every CURRENT permission as role defaults.
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role.id,
  permission.permission_key,
  true
from public.roles as role
cross join public.permissions as permission
where role.name in (
  'owner',
  'admin'
);


-- ============================================================
-- MANAGER DEFAULTS
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role.id,
  permission.permission_key,
  true
from public.roles as role
join public.permissions as permission
  on permission.permission_key = any (
    array[
      'dashboard.view',

      'projects.view',
      'projects.create',
      'projects.edit',
      'projects.assign',

      'tickets.view',
      'tickets.create',
      'tickets.edit',
      'tickets.assign',

      'clients.view',

      'todo.view',
      'todo.manage',

      'invoices.view',
      'subscriptions.view',

      'services.view',
      'forms.view'
    ]::text[]
  )
where role.name = 'manager';


-- ============================================================
-- STAFF DEFAULTS
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role.id,
  permission.permission_key,
  true
from public.roles as role
join public.permissions as permission
  on permission.permission_key = any (
    array[
      'dashboard.view',

      'projects.view',

      'tickets.view',
      'tickets.create',
      'tickets.edit',

      'todo.view',

      'services.view',
      'forms.view'
    ]::text[]
  )
where role.name = 'staff';


-- ============================================================
-- CLIENT DEFAULTS
--
-- These permissions describe FEATURES only.
--
-- They do NOT broaden data scope.
-- Existing/future RLS still determines which company/project/
-- invoice rows a client is actually allowed to access.
-- ============================================================

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role.id,
  permission.permission_key,
  true
from public.roles as role
join public.permissions as permission
  on permission.permission_key = any (
    array[
      'dashboard.view',
      'projects.view',
      'tickets.view',
      'tickets.create',
      'invoices.view',
      'subscriptions.view'
    ]::text[]
  )
where role.name = 'client';


-- ============================================================
-- PRIVATE AUTHORITATIVE RESOLVER
--
-- Resolution:
--
-- 1. no active profile -> deny
-- 2. unknown permission -> deny
-- 3. owner -> allow
-- 4. explicit profile override
-- 5. role default
-- 6. deny
-- ============================================================

create or replace function private.current_user_has_permission(
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
          when role_row.name = 'owner'
            then true

          else coalesce(
            (
              select profile_override.allowed
              from public.profile_permission_overrides as profile_override
              where profile_override.profile_id = profile_row.id
                and profile_override.permission_key = p_permission_key
            ),
            (
              select role_permission.allowed
              from public.role_permissions as role_permission
              where role_permission.role_id = profile_row.role_id
                and role_permission.permission_key = p_permission_key
            ),
            false
          )
        end

      from public.profiles as profile_row

      join public.roles as role_row
        on role_row.id = profile_row.role_id

      where profile_row.id = auth.uid()
        and profile_row.archived_at is null

        and exists (
          select 1
          from public.permissions as permission
          where permission.permission_key = p_permission_key
        )
    ),
    false
  );
$$;


-- ============================================================
-- INTERNAL REQUIRE GUARD
--
-- Intended for future SECURITY DEFINER application RPCs.
-- Not callable directly by authenticated users.
-- ============================================================

create or replace function private.require_permission(
  p_permission_key text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_has_permission(
    p_permission_key
  ) then
    raise exception
      'permission denied: %',
      p_permission_key
      using errcode = '42501';
  end if;
end;
$$;


-- ============================================================
-- SAFE PUBLIC READ API
-- ============================================================

create or replace function public.app_has_permission(
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_has_permission(
    p_permission_key
  );
$$;


create or replace function public.app_current_user_permissions()
returns table (
  permission_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select permission.permission_key
  from public.permissions as permission
  where private.current_user_has_permission(
    permission.permission_key
  )
  order by permission.permission_key;
$$;


-- ============================================================
-- FUNCTION PRIVILEGES
-- ============================================================

revoke all
on function private.current_user_has_permission(text)
from public;

revoke all
on function private.current_user_has_permission(text)
from anon, authenticated;


revoke all
on function private.require_permission(text)
from public;

revoke all
on function private.require_permission(text)
from anon, authenticated;


revoke all
on function public.app_has_permission(text)
from public;

revoke all
on function public.app_has_permission(text)
from anon;

grant execute
on function public.app_has_permission(text)
to authenticated;


revoke all
on function public.app_current_user_permissions()
from public;

revoke all
on function public.app_current_user_permissions()
from anon;

grant execute
on function public.app_current_user_permissions()
to authenticated;