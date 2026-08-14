-- Wolf Forge Platform - account provisioning + permission presets backend
--
-- Two account classes share one permission engine:
--
--   internal  owner / admin / manager / staff
--   client    client
--
-- Design note on "one source of truth":
--
--   public.roles              account identity (unchanged)
--   public.permissions        capability catalog (unchanged)
--   public.role_permissions   the physical preset grant store (unchanged)
--   public.profile_permission_overrides   per-profile allow/deny (unchanged)
--
-- A permission preset is the account-class-aware presentation of an existing
-- role plus its grants. permission_presets is a 1:1 companion of roles and
-- permission_preset_grants is a projection of role_permissions, so no second
-- competing grant store is introduced. Every earlier migration that seeds
-- role_permissions keeps working untouched.
--
-- Effective permission = profile override, else preset grant, else deny.
-- The owner preset keeps its existing resolver bypass.

-- -----------------------------------------------------------------------------
-- Presets
-- -----------------------------------------------------------------------------

create table public.permission_presets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  account_class text not null,
  system_managed boolean not null default true,
  role_id uuid not null unique
    references public.roles (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint permission_presets_key_format_check
    check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint permission_presets_name_not_blank
    check (btrim(name) <> ''),
  constraint permission_presets_account_class_valid
    check (account_class in ('internal', 'client'))
);

create index permission_presets_account_class_idx
on public.permission_presets (account_class);

create trigger permission_presets_set_updated_at
before update on public.permission_presets
for each row
execute function private.set_updated_at();

insert into public.permission_presets (
  key,
  name,
  account_class,
  system_managed,
  role_id,
  sort_order
)
select
  seed.key,
  seed.name,
  seed.account_class,
  true,
  role_row.id,
  seed.sort_order
from (
  values
    ('owner'::text, 'Owner'::text, 'internal'::text, 10),
    ('admin', 'Administrator', 'internal', 20),
    ('manager', 'Manager', 'internal', 30),
    ('staff', 'Staff', 'internal', 40),
    ('client', 'Client', 'client', 50)
) as seed(key, name, account_class, sort_order)
join public.roles as role_row
  on role_row.name = seed.key;

-- System presets are reliable defaults. Custom preset authoring is deferred.
create or replace function private.protect_system_permission_preset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_managed then
      raise exception 'system permission presets cannot be deleted'
        using errcode = '42501';
    end if;

    return old;
  end if;

  if old.system_managed
    and (
      new.key is distinct from old.key
      or new.account_class is distinct from old.account_class
      or new.role_id is distinct from old.role_id
      or new.system_managed is distinct from old.system_managed
    )
  then
    raise exception 'system permission presets cannot be redefined'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger permission_presets_protect_system
before update or delete on public.permission_presets
for each row
execute function private.protect_system_permission_preset();

-- Preset grants are a projection of the existing role grant store.
create view public.permission_preset_grants
with (security_invoker = true)
as
select
  preset_row.id as preset_id,
  preset_row.key as preset_key,
  preset_row.account_class,
  grant_row.permission_key,
  grant_row.allowed
from public.permission_presets as preset_row
join public.role_permissions as grant_row
  on grant_row.role_id = preset_row.role_id;

comment on view public.permission_preset_grants
is 'Read projection of public.role_permissions keyed by preset. role_permissions remains the single physical grant store.';

-- -----------------------------------------------------------------------------
-- Module boundaries derived from real capabilities
-- -----------------------------------------------------------------------------

create table public.permission_modules (
  module_key text primary key,
  label text not null,
  account_class text not null,
  required_permission_key text not null
    references public.permissions (permission_key) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint permission_modules_key_format_check
    check (module_key ~ '^[a-z][a-z0-9_]*$'),
  constraint permission_modules_label_not_blank
    check (btrim(label) <> ''),
  constraint permission_modules_account_class_valid
    check (account_class in ('internal', 'client'))
);

create trigger permission_modules_set_updated_at
before update on public.permission_modules
for each row
execute function private.set_updated_at();

-- The Forms portal module needs a client-side read boundary. forms.view is the
-- existing capability for it; internal Forms tables stay gated behind
-- private.is_internal_user() so this grants no internal Forms access.
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'forms.view', true
from public.roles as role_row
where role_row.name = 'client'
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

insert into public.permission_modules (
  module_key,
  label,
  account_class,
  required_permission_key,
  sort_order
)
values
  ('dashboard', 'Dashboard', 'internal', 'dashboard.view', 10),
  ('projects', 'Projects', 'internal', 'projects.view', 20),
  ('tickets', 'Tickets', 'internal', 'tickets.view', 30),
  ('clients', 'Clients', 'internal', 'clients.view', 40),
  ('todo', 'To-do', 'internal', 'todo.view', 50),
  ('invoices', 'Invoices', 'internal', 'invoices.view', 60),
  ('subscriptions', 'Subscriptions', 'internal', 'subscriptions.view', 70),
  ('coupons', 'Coupons', 'internal', 'coupons.view', 80),
  ('services', 'Services', 'internal', 'services.view', 90),
  ('forms', 'Forms', 'internal', 'forms.view', 100),
  ('team', 'Team', 'internal', 'users.view', 110),
  ('settings', 'Settings', 'internal', 'settings.view', 120),

  ('portal_dashboard', 'Dashboard', 'client', 'dashboard.view', 10),
  ('portal_projects', 'Projects', 'client', 'projects.view', 20),
  ('portal_tickets', 'Tickets', 'client', 'tickets.view', 30),
  ('portal_forms', 'Forms', 'client', 'forms.view', 40),
  ('portal_invoices', 'Invoices', 'client', 'invoices.view', 50),
  ('portal_subscriptions', 'Subscriptions', 'client', 'subscriptions.view', 60);

-- -----------------------------------------------------------------------------
-- One authoritative resolver
-- -----------------------------------------------------------------------------

create or replace function private.profile_permission_preset_key(
  p_profile_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select preset_row.key
  from public.profiles as profile_row
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where profile_row.id = p_profile_id
    and profile_row.archived_at is null;
$$;

create or replace function private.profile_account_class(
  p_profile_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select preset_row.account_class
  from public.profiles as profile_row
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where profile_row.id = p_profile_id
    and profile_row.archived_at is null;
$$;

-- Resolution order, unchanged from the existing role resolver:
--   1. no active profile        -> deny
--   2. unknown permission       -> deny
--   3. owner preset             -> allow
--   4. explicit profile override
--   5. preset grant
--   6. deny
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
              where profile_override.profile_id = profile_row.id
                and profile_override.permission_key = p_permission_key
            ),
            (
              select preset_grant.allowed
              from public.role_permissions as preset_grant
              where preset_grant.role_id = profile_row.role_id
                and preset_grant.permission_key = p_permission_key
            ),
            false
          )
        end

      from public.profiles as profile_row

      join public.permission_presets as preset_row
        on preset_row.role_id = profile_row.role_id

      where profile_row.id = p_profile_id
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

-- The existing predicate now delegates to the shared resolver so there is
-- exactly one implementation of preset + override resolution.
create or replace function private.current_user_has_permission(
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_has_permission(
    (select auth.uid()),
    p_permission_key
  );
$$;

create or replace function private.current_account_class()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_account_class((select auth.uid()));
$$;

-- -----------------------------------------------------------------------------
-- Administration guards
-- -----------------------------------------------------------------------------

create or replace function private.require_permission_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('users.manage_permissions');
  return actor_id;
end;
$$;

-- Actor identity always comes from auth.uid(); the target is never trusted to
-- describe who is asking.
create or replace function private.require_permission_admin_for_target(
  p_profile_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_permission_manager();
begin
  if p_profile_id is null then
    raise exception 'a target profile is required'
      using errcode = '22023';
  end if;

  -- Self-service promotion and self-service override editing are never allowed,
  -- regardless of how privileged the caller is.
  if p_profile_id = actor_id then
    raise exception 'permission configuration cannot be changed for your own account'
      using errcode = '42501';
  end if;

  if private.profile_account_class(p_profile_id) is null then
    raise exception 'target profile was not found'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

-- A client may only ever hold capabilities the client preset or a client portal
-- module already expresses. Internal capabilities can never be granted to a
-- client account through an override.
create or replace function private.is_client_eligible_permission(
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.permission_modules as module_row
      where module_row.account_class = 'client'
        and module_row.required_permission_key = p_permission_key
    )
    or exists (
      select 1
      from public.permission_presets as preset_row
      join public.role_permissions as preset_grant
        on preset_grant.role_id = preset_row.role_id
      where preset_row.account_class = 'client'
        and preset_grant.permission_key = p_permission_key
        and preset_grant.allowed
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
    from public.profiles as profile_row
    join public.permission_presets as preset_row
      on preset_row.role_id = profile_row.role_id
    where profile_row.archived_at is null
      and preset_row.account_class = 'internal'
      and private.profile_has_permission(
        profile_row.id,
        'users.manage_permissions'
      )
  ) then
    raise exception 'at least one active internal account must retain permission management'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function private.apply_profile_permission_override(
  p_profile_id uuid,
  p_permission_key text,
  p_allowed boolean
)
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
    profile_id,
    permission_key,
    allowed
  )
  values (
    p_profile_id,
    p_permission_key,
    p_allowed
  )
  on conflict (profile_id, permission_key) do update
  set allowed = excluded.allowed,
      updated_at = now();
end;
$$;

-- Provisioning override payload: [{"permission_key": "...", "allowed": true}]
create or replace function private.apply_profile_permission_overrides(
  p_profile_id uuid,
  p_overrides jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  override_row jsonb;
  applied integer := 0;
begin
  if p_overrides is null or p_overrides = 'null'::jsonb then
    return 0;
  end if;

  if jsonb_typeof(p_overrides) <> 'array' then
    raise exception 'permission overrides must be a JSON array'
      using errcode = '22023';
  end if;

  for override_row in
    select value from jsonb_array_elements(p_overrides) as element(value)
  loop
    if jsonb_typeof(override_row) <> 'object'
      or not (override_row ? 'permission_key')
      or not (override_row ? 'allowed')
      or jsonb_typeof(override_row -> 'allowed') <> 'boolean'
    then
      raise exception 'each permission override requires permission_key and allowed'
        using errcode = '22023';
    end if;

    perform private.apply_profile_permission_override(
      p_profile_id,
      override_row ->> 'permission_key',
      (override_row ->> 'allowed')::boolean
    );

    applied := applied + 1;
  end loop;

  return applied;
end;
$$;

-- -----------------------------------------------------------------------------
-- Effective permission reads
-- -----------------------------------------------------------------------------

create or replace function public.app_get_profile_effective_permissions(
  p_profile_id uuid default null
)
returns table (
  permission_key text,
  category text,
  allowed boolean,
  source text
)
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
        where override_row.profile_id = target_id
          and override_row.permission_key = permission_row.permission_key
      ) then 'override'
      else 'preset'
    end
  from public.permissions as permission_row
  order by permission_row.permission_key;
end;
$$;

create or replace function public.app_get_profile_permission_summary(
  p_profile_id uuid default null
)
returns table (
  profile_id uuid,
  display_name text,
  preset_key text,
  preset_name text,
  account_class text,
  company_id uuid,
  override_count integer
)
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
    profile_row.company_id,
    (
      select count(*)::integer
      from public.profile_permission_overrides as override_row
      where override_row.profile_id = profile_row.id
    )
  from public.profiles as profile_row
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where profile_row.id = target_id
    and profile_row.archived_at is null;
end;
$$;

create or replace function public.app_list_permission_presets()
returns table (
  preset_id uuid,
  preset_key text,
  preset_name text,
  account_class text,
  system_managed boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission_manager();

  return query
  select
    preset_row.id,
    preset_row.key,
    preset_row.name,
    preset_row.account_class,
    preset_row.system_managed,
    preset_row.sort_order
  from public.permission_presets as preset_row
  order by preset_row.sort_order, preset_row.key;
end;
$$;

-- Module visibility is derived from a real capability, never from a duplicated
-- "*.tab" permission. UI hiding is a consequence of this, not a substitute.
create or replace function public.app_current_user_modules()
returns table (
  module_key text,
  label text,
  account_class text,
  required_permission_key text,
  granted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_class text := private.current_account_class();
begin
  if caller_class is null then
    raise exception 'authentication is required'
      using errcode = '42501';
  end if;

  return query
  select
    module_row.module_key,
    module_row.label,
    module_row.account_class,
    module_row.required_permission_key,
    private.current_user_has_permission(module_row.required_permission_key)
  from public.permission_modules as module_row
  where module_row.account_class = caller_class
  order by module_row.sort_order, module_row.module_key;
end;
$$;

-- Server-side route/RPC guard. Typing the URL cannot bypass this.
create or replace function public.app_require_module_access(
  p_module_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_class text := private.current_account_class();
  module_row public.permission_modules;
begin
  if caller_class is null then
    raise exception 'authentication is required'
      using errcode = '42501';
  end if;

  select * into module_row
  from public.permission_modules as candidate
  where candidate.module_key = p_module_key;

  if module_row.module_key is null
    or module_row.account_class <> caller_class
  then
    raise exception 'module access is denied: %', p_module_key
      using errcode = '42501';
  end if;

  perform private.require_permission(module_row.required_permission_key);

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Capability management
-- -----------------------------------------------------------------------------

create or replace function public.app_set_profile_permission_preset(
  p_profile_id uuid,
  p_preset_key text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles;
  preset_row public.permission_presets;
  previous_preset text;
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

  update public.profiles as target_profile
  set role_id = preset_row.role_id
  where target_profile.id = p_profile_id
    and target_profile.archived_at is null
  returning target_profile.* into profile_row;

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

create or replace function public.app_set_profile_permission_override(
  p_profile_id uuid,
  p_permission_key text,
  p_allowed boolean
)
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
  where stored.profile_id = p_profile_id
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

create or replace function public.app_clear_profile_permission_override(
  p_profile_id uuid,
  p_permission_key text
)
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
  where override_row.profile_id = p_profile_id
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

-- -----------------------------------------------------------------------------
-- Account provisioning
--
-- auth.users creation stays outside Postgres on the server-only Supabase Admin
-- boundary. Everything that decides access lives here, authorized against
-- auth.uid() and audited.
-- -----------------------------------------------------------------------------

create or replace function public.app_provision_internal_member_profile(
  p_profile_id uuid,
  p_preset_key text,
  p_display_name text default null,
  p_overrides jsonb default '[]'::jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  profile_row public.profiles;
  preset_row public.permission_presets;
  existing_class text;
  existing_preset text;
  normalized_display_name text := nullif(btrim(p_display_name), '');
  was_provisioned boolean := false;
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
  if existing_class = 'client' then
    if exists (
      select 1
      from public.profiles as candidate
      where candidate.id = p_profile_id
        and candidate.company_id is not null
    )
      or exists (
        select 1
        from public.client_contacts as contact_row
        where contact_row.profile_id = p_profile_id
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

create or replace function public.app_provision_client_account_profile(
  p_profile_id uuid,
  p_company_id uuid,
  p_display_name text default null,
  p_overrides jsonb default '[]'::jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
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
  from public.profiles as existing
  where existing.id = p_profile_id;

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
        'company_id', profile_row.company_id,
        'override_count', jsonb_array_length(coalesce(p_overrides, '[]'::jsonb))
      )
    );
  end if;

  return profile_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS and privileges
--
-- Permission configuration is never directly readable or writable by API roles.
-- Every read and write goes through the audited RPC boundary above.
-- -----------------------------------------------------------------------------

alter table public.permission_presets enable row level security;
alter table public.permission_modules enable row level security;

revoke all on table public.permission_presets from public, anon, authenticated;
revoke all on table public.permission_modules from public, anon, authenticated;
revoke all on table public.permission_preset_grants from public, anon, authenticated;

revoke all on table public.permission_presets from service_role;
revoke all on table public.permission_modules from service_role;
revoke all on table public.permission_preset_grants from service_role;

grant select on table public.permission_presets to service_role;
grant select on table public.permission_modules to service_role;
grant select on table public.permission_preset_grants to service_role;

revoke all on function private.protect_system_permission_preset()
from public, anon, authenticated, service_role;
revoke all on function private.profile_permission_preset_key(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.profile_account_class(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.profile_has_permission(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.current_account_class()
from public, anon, authenticated, service_role;
revoke all on function private.require_permission_manager()
from public, anon, authenticated, service_role;
revoke all on function private.require_permission_admin_for_target(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.is_client_eligible_permission(text)
from public, anon, authenticated, service_role;
revoke all on function private.assert_permission_management_retained()
from public, anon, authenticated, service_role;
revoke all on function private.apply_profile_permission_override(uuid, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.apply_profile_permission_overrides(uuid, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.app_get_profile_effective_permissions(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_get_profile_effective_permissions(uuid)
to authenticated;

revoke all on function public.app_get_profile_permission_summary(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_get_profile_permission_summary(uuid)
to authenticated;

revoke all on function public.app_list_permission_presets()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_permission_presets()
to authenticated;

revoke all on function public.app_current_user_modules()
from public, anon, authenticated, service_role;
grant execute on function public.app_current_user_modules()
to authenticated;

revoke all on function public.app_require_module_access(text)
from public, anon, authenticated, service_role;
grant execute on function public.app_require_module_access(text)
to authenticated;

revoke all on function public.app_set_profile_permission_preset(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.app_set_profile_permission_preset(uuid, text)
to authenticated;

revoke all on function public.app_set_profile_permission_override(uuid, text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.app_set_profile_permission_override(uuid, text, boolean)
to authenticated;

revoke all on function public.app_clear_profile_permission_override(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.app_clear_profile_permission_override(uuid, text)
to authenticated;

revoke all on function public.app_provision_internal_member_profile(uuid, text, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.app_provision_internal_member_profile(uuid, text, text, jsonb)
to authenticated;

revoke all on function public.app_provision_client_account_profile(uuid, uuid, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.app_provision_client_account_profile(uuid, uuid, text, jsonb)
to authenticated;

comment on table public.permission_presets
is 'Account-class-aware presentation of an existing role. One preset per role keeps a single source of truth for profile permission identity.';

comment on table public.permission_modules
is 'Maps a product module to the real capability that gates it, so navigation visibility and server-side rejection share one boundary.';

comment on function private.profile_has_permission(uuid, text)
is 'The single authoritative resolver: owner bypass, then explicit profile override, then preset grant, then deny.';

comment on function public.app_provision_internal_member_profile(uuid, text, text, jsonb)
is 'Completes Wolf Forge member provisioning after the server-only Supabase Admin boundary creates the auth user. Retry-safe on the same preset.';

comment on function public.app_provision_client_account_profile(uuid, uuid, text, jsonb)
is 'Completes client portal provisioning through the existing audited client membership boundary. Retry-safe for the same company.';
