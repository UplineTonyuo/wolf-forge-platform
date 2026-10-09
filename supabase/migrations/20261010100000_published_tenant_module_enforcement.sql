-- WL-2.34 Phase 1. No draft publication or seeded effective configuration.
-- Only Reporting may be disabled until other modules have complete coverage.
create table private.tenant_module_publications (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  revision integer not null check (revision > 0),
  module_keys text[] not null,
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  primary key (tenant_id, revision),
  check (not ('todo' = any(module_keys)))
);
alter table private.tenant_module_publications enable row level security;
revoke all on private.tenant_module_publications from public, anon, authenticated, service_role;

create function private.published_module_set_valid(p_keys text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_keys is not null
    and array_ndims(p_keys) = 1
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as requested(key))
    and not exists (
      select 1 from unnest(p_keys) as requested(key)
      where key is null or not exists (
        select 1 from private.white_label_modules as catalog where catalog.module_key = key
      )
    )
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- shortcut: only Reporting has complete enforcement, require the other eight until their audited slices ship.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key <> 'reporting' and not (catalog.module_key = any(p_keys))
    ), false);
$$;

create function private.validate_tenant_module_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  tenant_status text;
  last_revision integer;
begin
  if tg_op <> 'INSERT' then
    raise exception 'published module history is immutable' using errcode = '55000';
  end if;
  perform private.require_platform_admin();
  actor_id := auth.uid();
  select status into tenant_status from public.tenants where id = new.tenant_id for update;
  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  if tenant_status <> 'active' then
    raise exception 'Tenant is not active' using errcode = '55000';
  end if;
  if not private.published_module_set_valid(new.module_keys) then
    raise exception 'invalid or unsupported published module set' using errcode = '22023';
  end if;
  select coalesce(max(revision), 0) into last_revision
  from private.tenant_module_publications where tenant_id = new.tenant_id;
  if new.revision is distinct from last_revision + 1 then
    raise exception 'published revision conflict' using errcode = 'WF409';
  end if;
  new.published_by := actor_id;
  new.published_at := now();
  new.reason := btrim(new.reason);
  return new;
end;
$$;
create trigger tenant_module_publications_validate
before insert or update or delete on private.tenant_module_publications
for each row execute function private.validate_tenant_module_publication();

-- No operational API or Publish button. Explicit trusted provisioning only.
-- This writer cannot read/copy a White Label draft.
create function private.publish_tenant_modules(
  p_tenant_id uuid, p_expected_revision integer, p_module_keys text[], p_reason text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  tenant_status text;
  last_revision integer;
begin
  perform private.require_platform_admin();
  actor_id := auth.uid();
  select status into tenant_status from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  if tenant_status <> 'active' then
    raise exception 'Tenant is not active' using errcode = '55000';
  end if;
  select coalesce(max(revision), 0) into last_revision
  from private.tenant_module_publications where tenant_id = p_tenant_id;
  if p_expected_revision is null or p_expected_revision <> last_revision then
    raise exception 'published revision conflict' using errcode = 'WF409';
  end if;
  insert into private.tenant_module_publications
    (tenant_id, revision, module_keys, published_by, reason)
  values (p_tenant_id, last_revision + 1, p_module_keys, actor_id, p_reason);
  return last_revision + 1;
end;
$$;

create function private.tenant_module_allowed(p_tenant_id uuid, p_module_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  publication private.tenant_module_publications;
  canonical_key text := case p_module_key
    when 'portal_reporting' then 'reporting'
    when 'portal_projects' then 'projects'
    when 'portal_tickets' then 'tickets'
    when 'portal_forms' then 'forms'
    when 'portal_invoices' then 'invoices'
    when 'portal_subscriptions' then 'subscriptions'
    when 'portal_store' then 'services'
    else p_module_key end;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'active')
     or not exists (select 1 from public.permission_modules where module_key = p_module_key) then
    return false;
  end if;
  if canonical_key = 'todo' then
    return p_tenant_id = private.wolf_forge_tenant_id();
  end if;
  select * into publication from private.tenant_module_publications
  where tenant_id = p_tenant_id order by revision desc limit 1;
  if not found then
    return true; -- Compatibility: no published policy retains existing authorization.
  end if;
  if publication.revision < 1
    or publication.published_by is null or publication.published_at is null
    or nullif(btrim(publication.reason), '') is null
    or not private.published_module_set_valid(publication.module_keys) then
    return false;
  end if;
  if exists (select 1 from private.white_label_modules where module_key = canonical_key) then
    return canonical_key = any(publication.module_keys);
  end if;
  return true; -- Core modules are not configurable.
end;
$$;
revoke all on function private.published_module_set_valid(text[]) from public, anon, authenticated, service_role;
revoke all on function private.validate_tenant_module_publication() from public, anon, authenticated, service_role;
revoke all on function private.publish_tenant_modules(uuid, integer, text[], text) from public, anon, authenticated, service_role;
revoke all on function private.tenant_module_allowed(uuid, text) from public, anon, authenticated, service_role;

-- One existing membership/preset/override engine; policy narrows the result,
-- including owner, explicit-tenant trusted callers, legacy send and direct RLS.
create or replace function private.profile_has_permission_in_tenant(
  p_profile_id uuid, p_tenant_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = '' as $$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      else true end)
    and coalesce((
      select case when preset_row.key = 'owner' then true else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
         where profile_override.tenant_id = membership_row.tenant_id
           and profile_override.profile_id = membership_row.profile_id
           and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
         where preset_grant.role_id = membership_row.role_id
           and preset_grant.permission_key = p_permission_key), false) end
      from public.tenant_memberships as membership_row
      join public.permission_presets as preset_row on preset_row.role_id = membership_row.role_id
      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null
        and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
    ), false);
$$;

create or replace function public.app_require_module_access(p_module_key text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  caller_class text := private.current_account_class();
  module_row public.permission_modules;
begin
  if caller_class is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  select * into module_row from public.permission_modules where module_key = p_module_key;
  if module_row.module_key is null or module_row.account_class <> caller_class
    or not private.tenant_module_allowed(private.current_tenant_id(), p_module_key) then
    raise exception 'module access is denied: %', p_module_key using errcode = '42501';
  end if;
  perform private.require_permission(module_row.required_permission_key);
  return true;
end;
$$;

-- Receipts previously exposed only a profile predicate, without Tenant or module.
alter policy client_report_reads_select_own on public.client_report_reads
using (
  profile_id = (select auth.uid())
  and public.app_has_permission('reporting.view')
  and (select private.is_client_user())
  and exists (
    select 1 from public.client_reports as report
    where report.id = client_report_reads.report_id
      and report.tenant_id = (select private.current_tenant_id())
      and report.company_id = (select private.current_user_company_id())
      and report.status = 'sent' and report.archived_at is null
  )
);

-- Historical Reporting activity must not bypass policy through the admin branch.
create policy activity_events_published_reporting on public.activity_events
as restrictive for select to authenticated
using (entity_type <> 'client_report'
  or public.app_has_permission('reports.send'));
