-- WL-2.33 (KI-146 / D-298): persistent per-Tenant White Label DRAFTS.
--
-- A draft is configuration a Platform Admin is preparing for one Tenant. It
-- is NOT published: no authorization function, policy, navigation rule or
-- module gate reads these tables, so saving a draft changes nothing at
-- runtime. Publication and server-side module enforcement are later phases.
--
-- Authority: every read and write goes through a SECURITY DEFINER RPC that
-- first calls private.require_platform_admin() (WL-2.32, auth.uid() only).
-- A Tenant id only names the TARGET; the RPC checks that it exists. No API
-- role can touch the tables directly.

-- -----------------------------------------------------------------------------
-- Configurable module catalog: a subset of the canonical module registry
-- (public.permission_modules), with the one dependency each module may have.
-- -----------------------------------------------------------------------------

create table private.white_label_modules (
  module_key text primary key references public.permission_modules (module_key) on delete restrict,
  requires_module_key text references private.white_label_modules (module_key) on delete restrict,
  -- Operations (todo) is Wolf Forge-only (D-285) and never configurable.
  constraint white_label_modules_not_operations check (module_key <> 'todo'),
  constraint white_label_modules_not_self check (requires_module_key is distinct from module_key)
);

-- Projects (orders), Subscriptions and Investment Intent (service_interests)
-- have a NOT NULL service_id; Coupons only discount Services.
insert into private.white_label_modules (module_key, requires_module_key)
values
  ('services', null),
  ('tickets', null),
  ('reporting', null),
  ('invoices', null),
  ('forms', null),
  ('projects', 'services'),
  ('subscriptions', 'services'),
  ('coupons', 'services'),
  ('investment_intent', 'services');

alter table private.white_label_modules enable row level security;
revoke all on table private.white_label_modules from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- One current draft per Tenant
-- -----------------------------------------------------------------------------

create table private.tenant_white_label_drafts (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  display_name text not null,
  primary_color text not null,
  accent_color text not null,
  module_keys text[] not null,
  revision integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  constraint tenant_white_label_drafts_display_name_valid check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 60
    and display_name !~ '[[:cntrl:]]'
  ),
  constraint tenant_white_label_drafts_primary_color_valid check (primary_color ~ '^#[0-9a-f]{6}$'),
  constraint tenant_white_label_drafts_accent_color_valid check (accent_color ~ '^#[0-9a-f]{6}$'),
  constraint tenant_white_label_drafts_revision_positive check (revision >= 1),
  constraint tenant_white_label_drafts_no_operations check (not ('todo' = any (module_keys)))
);

alter table private.tenant_white_label_drafts enable row level security;
revoke all on table private.tenant_white_label_drafts from public, anon, authenticated, service_role;

-- Module keys are stored as a sorted, distinct set of configurable modules,
-- closed under their dependencies; the server time is always stamped.
create function private.tenant_white_label_drafts_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unknown text;
  v_missing text;
begin
  new.module_keys := coalesce(
    (select array_agg(distinct requested.key order by requested.key) from unnest(new.module_keys) as requested(key)),
    '{}'::text[]
  );

  select requested.key into v_unknown
  from unnest(new.module_keys) as requested(key)
  where requested.key is null
    or not exists (select 1 from private.white_label_modules as catalog where catalog.module_key = requested.key)
  limit 1;
  if found then
    raise exception 'Unknown or non-configurable module: %', coalesce(v_unknown, 'null') using errcode = '22023';
  end if;

  select catalog.module_key into v_missing
  from private.white_label_modules as catalog
  where catalog.module_key = any (new.module_keys)
    and catalog.requires_module_key is not null
    and not (catalog.requires_module_key = any (new.module_keys))
  limit 1;
  if found then
    raise exception 'Module % requires another module that is not selected', v_missing using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger tenant_white_label_drafts_validate
  before insert or update on private.tenant_white_label_drafts
  for each row execute function private.tenant_white_label_drafts_validate();

revoke all on function private.tenant_white_label_drafts_validate() from public, anon, authenticated, service_role;

insert into private.security_audit_event_codes (event_code, category, severity)
values ('authorization.white_label.draft_saved', 'authorization', 'info')
on conflict (event_code) do update
set category = excluded.category,
    severity = excluded.severity;

-- -----------------------------------------------------------------------------
-- Platform Admin RPCs
-- -----------------------------------------------------------------------------

-- Every existing Tenant, for the target selector.
create function public.app_list_white_label_tenants()
returns table (tenant_id uuid, slug text, display_name text, status text, draft_revision integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();

  return query
  select tenant_row.id, tenant_row.slug, tenant_row.display_name, tenant_row.status, draft_row.revision
  from public.tenants as tenant_row
  left join private.tenant_white_label_drafts as draft_row on draft_row.tenant_id = tenant_row.id
  order by tenant_row.id = private.wolf_forge_tenant_id() desc, tenant_row.display_name, tenant_row.id;
end;
$$;

-- The Tenant's draft, or revision 0 with the documented defaults when none
-- is saved yet: the Tenant's name, the Wolf Forge colors and every module
-- (what the CRM offers today). Reading never creates a row.
create function public.app_get_white_label_draft(p_tenant_id uuid)
returns table (
  tenant_id uuid,
  tenant_status text,
  display_name text,
  primary_color text,
  accent_color text,
  module_keys text[],
  revision integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();

  return query
  select
    tenant_row.id,
    tenant_row.status,
    coalesce(draft_row.display_name, btrim(left(tenant_row.display_name, 60))),
    coalesce(draft_row.primary_color, '#000d51'),
    coalesce(draft_row.accent_color, '#a8832e'),
    coalesce(
      draft_row.module_keys,
      (select array_agg(catalog.module_key order by catalog.module_key) from private.white_label_modules as catalog)
    ),
    coalesce(draft_row.revision, 0),
    draft_row.updated_at
  from public.tenants as tenant_row
  left join private.tenant_white_label_drafts as draft_row on draft_row.tenant_id = tenant_row.id
  where tenant_row.id = p_tenant_id;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Saves the draft only when p_expected_revision is the current revision
-- (0 = none saved yet); anything else is WF409, never last-write-wins. A
-- replay of this admin's own last save (lost response) returns it as
-- already applied instead of a conflict.
create function public.app_save_white_label_draft(
  p_tenant_id uuid,
  p_expected_revision integer,
  p_display_name text,
  p_primary_color text,
  p_accent_color text,
  p_module_keys text[]
)
returns table (revision integer, updated_at timestamptz, already_applied boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_current private.tenant_white_label_drafts;
  v_saved private.tenant_white_label_drafts;
  v_display_name text := btrim(p_display_name);
  v_primary text := lower(p_primary_color);
  v_accent text := lower(p_accent_color);
  v_modules text[] := coalesce(
    (select array_agg(distinct requested.key order by requested.key) from unnest(p_module_keys) as requested(key)),
    '{}'::text[]
  );
begin
  perform private.require_platform_admin();

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'A current draft revision is required' using errcode = '22023';
  end if;

  select tenant_row.status into v_status from public.tenants as tenant_row where tenant_row.id = p_tenant_id;
  if v_status is null then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active Tenant''s draft can be saved' using errcode = '55000';
  end if;

  select * into v_current
  from private.tenant_white_label_drafts as draft_row
  where draft_row.tenant_id = p_tenant_id
  for update;

  if coalesce(v_current.revision, 0) <> p_expected_revision then
    if v_current.revision = p_expected_revision + 1
      and v_current.updated_by = v_actor
      and v_current.display_name = v_display_name
      and v_current.primary_color = v_primary
      and v_current.accent_color = v_accent
      and v_current.module_keys = v_modules
    then
      return query select v_current.revision, v_current.updated_at, true;
      return;
    end if;
    raise exception 'The draft was changed since it was loaded' using errcode = 'WF409';
  end if;

  if v_current.tenant_id is null then
    insert into private.tenant_white_label_drafts as draft_row
      (tenant_id, display_name, primary_color, accent_color, module_keys, revision, updated_by)
    values (p_tenant_id, v_display_name, v_primary, v_accent, v_modules, 1, v_actor)
    on conflict on constraint tenant_white_label_drafts_pkey do nothing
    returning draft_row.* into v_saved;
    -- A concurrent first save won the race.
    if v_saved.tenant_id is null then
      raise exception 'The draft was changed since it was loaded' using errcode = 'WF409';
    end if;
  else
    update private.tenant_white_label_drafts as draft_row
    set display_name = v_display_name,
        primary_color = v_primary,
        accent_color = v_accent,
        module_keys = v_modules,
        revision = draft_row.revision + 1,
        updated_by = v_actor
    where draft_row.tenant_id = p_tenant_id
    returning draft_row.* into v_saved;
  end if;

  insert into public.security_audit_events (
    event_code, actor_profile_id, actor_class, action_slug, resource_type, resource_id, outcome, metadata
  )
  values (
    'authorization.white_label.draft_saved',
    v_actor,
    'internal',
    'white-label.draft.save',
    'tenant',
    p_tenant_id,
    'succeeded',
    pg_catalog.jsonb_build_object(
      'revision', v_saved.revision,
      'previous_revision', p_expected_revision,
      'module_count', pg_catalog.cardinality(v_saved.module_keys)
    )
  );

  return query select v_saved.revision, v_saved.updated_at, false;
end;
$$;

revoke all on function public.app_list_white_label_tenants() from public, anon, authenticated, service_role;
revoke all on function public.app_get_white_label_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_save_white_label_draft(uuid, integer, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_white_label_tenants() to authenticated;
grant execute on function public.app_get_white_label_draft(uuid) to authenticated;
grant execute on function public.app_save_white_label_draft(uuid, integer, text, text, text, text[]) to authenticated;
