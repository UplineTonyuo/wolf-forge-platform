-- Wolf Forge Platform - Services Engine MVP
-- Extends the audited catalog boundary with nested folders, operational
-- service configuration, retry-safe duplication, and a deterministic local
-- SEO Sprints starter catalog.

-- -----------------------------------------------------------------------------
-- Service folders and catalog fields
-- -----------------------------------------------------------------------------

create table public.service_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  parent_id uuid references public.service_folders (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint service_folders_name_not_blank check (btrim(name) <> ''),
  constraint service_folders_description_not_blank
    check (description is null or btrim(description) <> ''),
  constraint service_folders_image_url_not_blank
    check (image_url is null or btrim(image_url) <> ''),
  constraint service_folders_sort_order_nonnegative check (sort_order >= 0)
);

create index service_folders_parent_id_idx
on public.service_folders (parent_id)
where parent_id is not null;

create index service_folders_active_parent_sort_name_idx
on public.service_folders (parent_id, sort_order, name)
where archived_at is null;

create trigger service_folders_set_updated_at
before update on public.service_folders
for each row
execute function private.set_updated_at();

create or replace function private.validate_service_folder_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a service folder cannot be its own parent'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.service_folders as parent
    where parent.id = new.parent_id
      and parent.archived_at is null
  ) then
    raise exception 'service folder parent must be active'
      using errcode = '23514';
  end if;

  if exists (
    with recursive ancestors as (
      select folder.id, folder.parent_id
      from public.service_folders as folder
      where folder.id = new.parent_id
      union all
      select folder.id, folder.parent_id
      from public.service_folders as folder
      join ancestors on folder.id = ancestors.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'service folder nesting cannot contain a cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger service_folders_validate_parent
before insert or update of parent_id on public.service_folders
for each row
execute function private.validate_service_folder_parent();

alter table public.services
  add column folder_id uuid references public.service_folders (id) on delete set null,
  add column price numeric(12, 2) not null default 0,
  add column currency text not null default 'USD',
  add column image_url text,
  add column is_public boolean not null default true,
  add column recurring boolean not null default false,
  add column recurring_price numeric(12, 2),
  add column recurring_interval_length integer,
  add column recurring_interval_unit text,
  add column recurring_action text,
  add column group_quantities boolean not null default false,
  add column assigned_to_profile_id uuid references public.profiles (id) on delete set null,
  add column deadline_amount integer,
  add column deadline_unit text,
  add column require_client_profile boolean not null default false,
  add column sort_order integer not null default 0;

alter table public.services
  add constraint services_price_nonnegative check (price >= 0),
  add constraint services_currency_iso_code check (currency ~ '^[A-Z]{3}$'),
  add constraint services_image_url_not_blank
    check (image_url is null or btrim(image_url) <> ''),
  add constraint services_recurring_price_nonnegative
    check (recurring_price is null or recurring_price >= 0),
  add constraint services_recurring_interval_length_positive
    check (recurring_interval_length is null or recurring_interval_length > 0),
  add constraint services_recurring_interval_unit_valid
    check (recurring_interval_unit is null or recurring_interval_unit in ('D', 'W', 'M', 'Y')),
  add constraint services_recurring_action_valid
    check (recurring_action is null or recurring_action in ('none', 'reopen_order', 'create_order', 'client_request')),
  add constraint services_recurring_configuration_consistent check (
    (
      recurring
      and recurring_price is not null
      and recurring_interval_length is not null
      and recurring_interval_unit is not null
      and recurring_action is not null
    )
    or (
      not recurring
      and recurring_price is null
      and recurring_interval_length is null
      and recurring_interval_unit is null
      and recurring_action is null
    )
  ),
  add constraint services_deadline_amount_positive
    check (deadline_amount is null or deadline_amount > 0),
  add constraint services_deadline_unit_valid
    check (deadline_unit is null or deadline_unit in ('H', 'D')),
  add constraint services_deadline_configuration_consistent
    check ((deadline_amount is null) = (deadline_unit is null)),
  add constraint services_sort_order_nonnegative check (sort_order >= 0);

create index services_folder_id_idx on public.services (folder_id)
where folder_id is not null;

create index services_assigned_to_profile_id_idx
on public.services (assigned_to_profile_id)
where assigned_to_profile_id is not null;

create index services_active_folder_sort_name_idx
on public.services (folder_id, sort_order, name)
where archived_at is null;

create or replace function private.require_active_service_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.folder_id is not null
    and not exists (
      select 1
      from public.service_folders as folder
      where folder.id = new.folder_id
        and folder.archived_at is null
    )
  then
    raise exception 'service folder must be active'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger services_require_active_folder
before insert or update of folder_id on public.services
for each row
execute function private.require_active_service_folder();

create trigger services_require_internal_assignee
before insert or update of assigned_to_profile_id on public.services
for each row
execute function private.require_internal_assignee();

-- Folder mutations participate in the same append-only activity stream.
alter table public.activity_events
  drop constraint activity_events_entity_type_valid;

alter table public.activity_events
  add constraint activity_events_entity_type_valid check (
    entity_type in (
      'company',
      'client_contact',
      'service_folder',
      'service',
      'order',
      'order_task',
      'profile'
    )
  );

-- -----------------------------------------------------------------------------
-- RLS and privileges
-- -----------------------------------------------------------------------------

alter table public.service_folders enable row level security;

create policy service_folders_authenticated_select_active
on public.service_folders
for select
to authenticated
using (archived_at is null);

create policy service_folders_internal_select
on public.service_folders
for select
to authenticated
using ((select private.is_internal_user()));

drop policy services_authenticated_select_active on public.services;

create policy services_authenticated_select_active
on public.services
for select
to authenticated
using (is_active and is_public and archived_at is null);

revoke all on table public.service_folders
from anon, authenticated, service_role;

grant select on table public.service_folders to authenticated;
grant select, insert, update on table public.service_folders to service_role;

-- -----------------------------------------------------------------------------
-- Audited folder RPCs
-- -----------------------------------------------------------------------------

create function public.app_create_service_folder(
  p_request_id uuid,
  p_name text,
  p_description text default null,
  p_parent_id uuid default null,
  p_sort_order integer default 0
)
returns public.service_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'name', p_name,
    'description', p_description,
    'parent_id', p_parent_id,
    'sort_order', p_sort_order
  );
  existing_id uuid;
  folder_row public.service_folders;
begin
  existing_id := private.find_create_request(
    actor_id,
    'service_folder.create',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select folder.* into folder_row
    from public.service_folders as folder
    where folder.id = existing_id;
    if folder_row.id is null then raise no_data_found; end if;
    return folder_row;
  end if;

  insert into public.service_folders (name, description, parent_id, sort_order)
  values (p_name, p_description, p_parent_id, p_sort_order)
  returning * into folder_row;

  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.created',
    format('Created service folder %s.', folder_row.name)
  );
  perform private.remember_create_request(
    actor_id,
    'service_folder.create',
    p_request_id,
    request_payload,
    folder_row.id
  );
  return folder_row;
end;
$$;

create function public.app_update_service_folder(
  p_folder_id uuid,
  p_patch jsonb
)
returns public.service_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_row public.service_folders;
begin
  perform private.require_internal_actor();
  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'description', 'parent_id', 'sort_order'] <> '{}'::jsonb
  then
    raise exception 'invalid service folder update patch'
      using errcode = '22023';
  end if;

  update public.service_folders
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
      parent_id = case when p_patch ? 'parent_id' then (p_patch ->> 'parent_id')::uuid else parent_id end,
      sort_order = case when p_patch ? 'sort_order' then (p_patch ->> 'sort_order')::integer else sort_order end
  where id = p_folder_id
    and archived_at is null
  returning * into folder_row;

  if folder_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.updated',
    format('Updated service folder %s.', folder_row.name)
  );
  return folder_row;
end;
$$;

create function public.app_archive_service_folder(p_folder_id uuid)
returns public.service_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_row public.service_folders;
begin
  perform private.require_internal_actor();
  select folder.* into folder_row
  from public.service_folders as folder
  where folder.id = p_folder_id
  for update;

  if folder_row.id is null then raise no_data_found; end if;
  if folder_row.archived_at is not null then return folder_row; end if;

  update public.services set folder_id = null where folder_id = p_folder_id;
  update public.service_folders set parent_id = null where parent_id = p_folder_id;
  update public.service_folders
  set archived_at = now()
  where id = p_folder_id
  returning * into folder_row;

  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.archived',
    format('Archived service folder %s.', folder_row.name)
  );
  return folder_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Extended audited service RPCs
-- -----------------------------------------------------------------------------

drop function public.app_create_service(uuid, text, text, boolean);

create function public.app_create_service(
  p_request_id uuid,
  p_payload jsonb
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  existing_id uuid;
  service_row public.services;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ? 'name'
    or jsonb_typeof(p_payload -> 'name') <> 'string'
    or btrim(p_payload ->> 'name') = ''
    or p_payload - array[
      'name', 'folder_id', 'description', 'price', 'currency', 'image_url',
      'is_active', 'is_public', 'recurring', 'recurring_price',
      'recurring_interval_length', 'recurring_interval_unit',
      'recurring_action', 'group_quantities', 'assigned_to_profile_id',
      'deadline_amount', 'deadline_unit', 'require_client_profile', 'sort_order'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid service create payload'
      using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id,
    'service.create',
    p_request_id,
    p_payload
  );
  if existing_id is not null then
    select service.* into service_row
    from public.services as service
    where service.id = existing_id;
    if service_row.id is null then raise no_data_found; end if;
    return service_row;
  end if;

  insert into public.services (
    name,
    folder_id,
    description,
    price,
    currency,
    image_url,
    is_active,
    is_public,
    recurring,
    recurring_price,
    recurring_interval_length,
    recurring_interval_unit,
    recurring_action,
    group_quantities,
    assigned_to_profile_id,
    deadline_amount,
    deadline_unit,
    require_client_profile,
    sort_order
  )
  values (
    p_payload ->> 'name',
    (p_payload ->> 'folder_id')::uuid,
    p_payload ->> 'description',
    coalesce((p_payload ->> 'price')::numeric, 0),
    coalesce(p_payload ->> 'currency', 'USD'),
    p_payload ->> 'image_url',
    coalesce((p_payload ->> 'is_active')::boolean, true),
    coalesce((p_payload ->> 'is_public')::boolean, true),
    coalesce((p_payload ->> 'recurring')::boolean, false),
    (p_payload ->> 'recurring_price')::numeric,
    (p_payload ->> 'recurring_interval_length')::integer,
    p_payload ->> 'recurring_interval_unit',
    p_payload ->> 'recurring_action',
    coalesce((p_payload ->> 'group_quantities')::boolean, false),
    (p_payload ->> 'assigned_to_profile_id')::uuid,
    (p_payload ->> 'deadline_amount')::integer,
    p_payload ->> 'deadline_unit',
    coalesce((p_payload ->> 'require_client_profile')::boolean, false),
    coalesce((p_payload ->> 'sort_order')::integer, 0)
  )
  returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.created',
    format('Created service %s.', service_row.name),
    jsonb_build_object('folder_id', service_row.folder_id)
  );
  perform private.remember_create_request(
    actor_id,
    'service.create',
    p_request_id,
    p_payload,
    service_row.id
  );
  return service_row;
end;
$$;

create or replace function public.app_update_service(
  p_service_id uuid,
  p_patch jsonb
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_row public.services;
begin
  perform private.require_internal_actor();
  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array[
      'name', 'folder_id', 'description', 'price', 'currency', 'image_url',
      'is_active', 'is_public', 'recurring', 'recurring_price',
      'recurring_interval_length', 'recurring_interval_unit',
      'recurring_action', 'group_quantities', 'assigned_to_profile_id',
      'deadline_amount', 'deadline_unit', 'require_client_profile', 'sort_order'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid service update patch'
      using errcode = '22023';
  end if;

  update public.services
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      folder_id = case when p_patch ? 'folder_id' then (p_patch ->> 'folder_id')::uuid else folder_id end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
      price = case when p_patch ? 'price' then (p_patch ->> 'price')::numeric else price end,
      currency = case when p_patch ? 'currency' then p_patch ->> 'currency' else currency end,
      image_url = case when p_patch ? 'image_url' then p_patch ->> 'image_url' else image_url end,
      is_active = case when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean else is_active end,
      is_public = case when p_patch ? 'is_public' then (p_patch ->> 'is_public')::boolean else is_public end,
      recurring = case when p_patch ? 'recurring' then (p_patch ->> 'recurring')::boolean else recurring end,
      recurring_price = case when p_patch ? 'recurring_price' then (p_patch ->> 'recurring_price')::numeric else recurring_price end,
      recurring_interval_length = case when p_patch ? 'recurring_interval_length' then (p_patch ->> 'recurring_interval_length')::integer else recurring_interval_length end,
      recurring_interval_unit = case when p_patch ? 'recurring_interval_unit' then p_patch ->> 'recurring_interval_unit' else recurring_interval_unit end,
      recurring_action = case when p_patch ? 'recurring_action' then p_patch ->> 'recurring_action' else recurring_action end,
      group_quantities = case when p_patch ? 'group_quantities' then (p_patch ->> 'group_quantities')::boolean else group_quantities end,
      assigned_to_profile_id = case when p_patch ? 'assigned_to_profile_id' then (p_patch ->> 'assigned_to_profile_id')::uuid else assigned_to_profile_id end,
      deadline_amount = case when p_patch ? 'deadline_amount' then (p_patch ->> 'deadline_amount')::integer else deadline_amount end,
      deadline_unit = case when p_patch ? 'deadline_unit' then p_patch ->> 'deadline_unit' else deadline_unit end,
      require_client_profile = case when p_patch ? 'require_client_profile' then (p_patch ->> 'require_client_profile')::boolean else require_client_profile end,
      sort_order = case when p_patch ? 'sort_order' then (p_patch ->> 'sort_order')::integer else sort_order end
  where id = p_service_id
    and archived_at is null
  returning * into service_row;

  if service_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.updated',
    format('Updated service %s.', service_row.name),
    jsonb_build_object('folder_id', service_row.folder_id)
  );
  return service_row;
end;
$$;

create function public.app_duplicate_service(
  p_request_id uuid,
  p_service_id uuid
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object('service_id', p_service_id);
  existing_id uuid;
  source_row public.services;
  service_row public.services;
begin
  existing_id := private.find_create_request(
    actor_id,
    'service.duplicate',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select service.* into service_row
    from public.services as service
    where service.id = existing_id;
    if service_row.id is null then raise no_data_found; end if;
    return service_row;
  end if;

  select service.* into source_row
  from public.services as service
  where service.id = p_service_id
    and service.archived_at is null;
  if source_row.id is null then raise no_data_found; end if;

  insert into public.services (
    name, folder_id, description, price, currency, image_url, is_active,
    is_public, recurring, recurring_price, recurring_interval_length,
    recurring_interval_unit, recurring_action, group_quantities,
    assigned_to_profile_id, deadline_amount, deadline_unit,
    require_client_profile, sort_order
  ) values (
    source_row.name || ' (Copy)', source_row.folder_id, source_row.description,
    source_row.price, source_row.currency, source_row.image_url,
    source_row.is_active, source_row.is_public, source_row.recurring,
    source_row.recurring_price, source_row.recurring_interval_length,
    source_row.recurring_interval_unit, source_row.recurring_action,
    source_row.group_quantities, source_row.assigned_to_profile_id,
    source_row.deadline_amount, source_row.deadline_unit,
    source_row.require_client_profile, source_row.sort_order + 1
  ) returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.duplicated',
    format('Duplicated service %s.', source_row.name),
    jsonb_build_object('source_service_id', source_row.id)
  );
  perform private.remember_create_request(
    actor_id,
    'service.duplicate',
    p_request_id,
    request_payload,
    service_row.id
  );
  return service_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deterministic local SEO Sprints starter catalog
-- -----------------------------------------------------------------------------

create function private.seed_seo_sprints_catalog()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_id constant uuid := '5e000000-0000-4000-8000-000000000001';
begin
  insert into public.service_folders (
    id, name, description, image_url, parent_id, sort_order, archived_at
  ) values (
    folder_id, 'SEO Sprints', null, null, null, 0, null
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    image_url = excluded.image_url,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    archived_at = excluded.archived_at;

  insert into public.services (
    id, name, folder_id, description, price, currency, image_url,
    is_active, is_public, recurring, recurring_price,
    recurring_interval_length, recurring_interval_unit, recurring_action,
    group_quantities, assigned_to_profile_id, deadline_amount, deadline_unit,
    require_client_profile, sort_order, archived_at
  ) values
    ('5e000000-0000-4000-8000-000000000101', 'MAPS SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 1, null),
    ('5e000000-0000-4000-8000-000000000102', 'SEO SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 2, null),
    ('5e000000-0000-4000-8000-000000000103', 'AI VISIBILITY SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 3, null),
    ('5e000000-0000-4000-8000-000000000104', 'WEBSITE SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 4, null),
    ('5e000000-0000-4000-8000-000000000105', 'LEAD GEN SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 5, null),
    ('5e000000-0000-4000-8000-000000000106', 'CONVERSION SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 6, null),
    ('5e000000-0000-4000-8000-000000000107', 'COMPETITOR SPRINT', folder_id, null, 97, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 7, null),
    ('5e000000-0000-4000-8000-000000000108', 'LEAD GENERATION SYSTEM', folder_id, null, 2500, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 8, null),
    ('5e000000-0000-4000-8000-000000000109', 'Conversion Optimization System', folder_id, null, 997, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 9, null),
    ('5e000000-0000-4000-8000-000000000110', 'Competitive Domination Blueprint', folder_id, null, 497, 'USD', null, true, true, false, null, null, null, null, false, null, null, null, false, 10, null)
  on conflict (id) do update set
    name = excluded.name,
    folder_id = excluded.folder_id,
    description = excluded.description,
    price = excluded.price,
    currency = excluded.currency,
    image_url = excluded.image_url,
    is_active = excluded.is_active,
    is_public = excluded.is_public,
    recurring = excluded.recurring,
    recurring_price = excluded.recurring_price,
    recurring_interval_length = excluded.recurring_interval_length,
    recurring_interval_unit = excluded.recurring_interval_unit,
    recurring_action = excluded.recurring_action,
    group_quantities = excluded.group_quantities,
    assigned_to_profile_id = excluded.assigned_to_profile_id,
    deadline_amount = excluded.deadline_amount,
    deadline_unit = excluded.deadline_unit,
    require_client_profile = excluded.require_client_profile,
    sort_order = excluded.sort_order,
    archived_at = excluded.archived_at;
end;
$$;

select private.seed_seo_sprints_catalog();

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function private.validate_service_folder_parent()
from public, anon, authenticated, service_role;
revoke all on function private.require_active_service_folder()
from public, anon, authenticated, service_role;
revoke all on function private.seed_seo_sprints_catalog()
from public, anon, authenticated, service_role;

revoke all on function public.app_create_service_folder(uuid, text, text, uuid, integer)
from public, anon, service_role;
revoke all on function public.app_update_service_folder(uuid, jsonb)
from public, anon, service_role;
revoke all on function public.app_archive_service_folder(uuid)
from public, anon, service_role;
revoke all on function public.app_create_service(uuid, jsonb)
from public, anon, service_role;
revoke all on function public.app_duplicate_service(uuid, uuid)
from public, anon, service_role;

grant execute on function public.app_create_service_folder(uuid, text, text, uuid, integer)
to authenticated;
grant execute on function public.app_update_service_folder(uuid, jsonb)
to authenticated;
grant execute on function public.app_archive_service_folder(uuid)
to authenticated;
grant execute on function public.app_create_service(uuid, jsonb)
to authenticated;
grant execute on function public.app_duplicate_service(uuid, uuid)
to authenticated;
