-- Wolf Forge Platform
-- Pre-deploy P0 authorization controls for confirmed findings H-01 through H-05.
--
-- This forward-only migration deliberately leaves the unrelated medium, low,
-- and hardening audit findings unchanged.

-- =============================================================================
-- H-01: Clients module and capability enforcement for company administration
-- =============================================================================

drop policy if exists companies_internal_select on public.companies;

create policy companies_internal_select
on public.companies
for select
to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('clients.view')
);

-- Operational modules need a narrow company selector without gaining the full
-- companies row (notably stripe_customer_id) or the Clients workspace. The
-- existing client_directory.read capability is the explicit authority for
-- this minimal DTO.
create or replace function public.app_list_client_company_directory()
returns table (
  id uuid,
  name text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_directory.read');

  return query
  select
    company_row.id,
    company_row.name,
    company_row.status,
    company_row.created_at,
    company_row.updated_at,
    company_row.archived_at
  from public.companies as company_row
  where company_row.archived_at is null
  order by company_row.name, company_row.id;
end;
$$;

revoke all on function public.app_list_client_company_directory()
from public, anon, service_role;
grant execute on function public.app_list_client_company_directory()
to authenticated;

create or replace function public.app_create_company(
  p_request_id uuid,
  p_name text
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object('name', p_name);
  existing_id uuid;
  company_row public.companies;
begin
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.create');

  existing_id := private.find_create_request(
    actor_id,
    'company.create',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select company.* into company_row
    from public.companies as company
    where company.id = existing_id;
    if company_row.id is null then raise no_data_found; end if;
    return company_row;
  end if;

  insert into public.companies (name)
  values (p_name)
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.created',
    format('Created client %s.', company_row.name)
  );
  perform private.remember_create_request(
    actor_id,
    'company.create',
    p_request_id,
    request_payload,
    company_row.id
  );
  return company_row;
end;
$$;

create or replace function public.app_update_company(
  p_company_id uuid,
  p_patch jsonb
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
  previous_status text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'status'] <> '{}'::jsonb
  then
    raise exception 'invalid client update patch'
      using errcode = '22023';
  end if;

  if p_patch ? 'status' then
    if jsonb_typeof(p_patch -> 'status') <> 'string'
      or (p_patch ->> 'status') not in (
        'contact',
        'lead',
        'client',
        'client_team'
      )
    then
      raise exception 'invalid client status'
        using errcode = '22023';
    end if;
  end if;

  select company.status
  into previous_status
  from public.companies as company
  where company.id = p_company_id
    and company.archived_at is null;

  if not found then raise no_data_found; end if;

  update public.companies
  set
    name = case
      when p_patch ? 'name' then p_patch ->> 'name'
      else name
    end,
    status = case
      when p_patch ? 'status' then p_patch ->> 'status'
      else status
    end
  where id = p_company_id
    and archived_at is null
  returning * into company_row;

  if p_patch ? 'status'
    and previous_status is distinct from company_row.status
  then
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format(
        'Changed client status from %s to %s.',
        initcap(replace(previous_status, '_', ' ')),
        initcap(replace(company_row.status, '_', ' '))
      ),
      jsonb_build_object(
        'field', 'status',
        'from', previous_status,
        'to', company_row.status
      )
    );
  else
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format('Updated client %s.', company_row.name)
    );
  end if;

  return company_row;
end;
$$;

create or replace function public.app_archive_company(p_company_id uuid)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.archive');

  select company.* into company_row
  from public.companies as company
  where company.id = p_company_id
  for update;

  if company_row.id is null then raise no_data_found; end if;
  if company_row.archived_at is not null then return company_row; end if;

  update public.companies
  set archived_at = now()
  where id = p_company_id
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.archived',
    format('Archived client %s.', company_row.name)
  );
  return company_row;
end;
$$;

-- =============================================================================
-- H-03: caller-scoped, column-safe client Project read model
-- =============================================================================

drop policy if exists orders_client_select_own_company on public.orders;
drop policy if exists order_tasks_client_select_own_company on public.order_tasks;

create or replace function public.app_list_my_client_projects(
  p_limit integer default 2000
)
returns table (
  id uuid,
  order_number bigint,
  title text,
  status text,
  created_at timestamptz,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  service_name text,
  task_total integer,
  task_open integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_company_id uuid;
  safe_limit integer := least(greatest(coalesce(p_limit, 2000), 1), 2000);
begin
  perform public.app_require_module_access('portal_projects');
  perform private.require_permission('projects.view');

  actor_company_id := private.current_user_company_id();
  if actor_company_id is null then
    raise exception 'Project access is denied' using errcode = '42501';
  end if;

  return query
  select
    project.id,
    project.order_number,
    project.title,
    project.status,
    project.created_at,
    project.due_at,
    project.started_at,
    project.completed_at,
    service_row.name,
    coalesce(task_counts.task_total, 0),
    coalesce(task_counts.task_open, 0)
  from public.orders as project
  left join public.services as service_row
    on service_row.id = project.service_id
  left join lateral (
    select
      count(*)::integer as task_total,
      count(*) filter (
        where task.status in ('todo', 'in_progress', 'blocked')
      )::integer as task_open
    from public.order_tasks as task
    where task.order_id = project.id
      and task.archived_at is null
  ) as task_counts on true
  where project.company_id = actor_company_id
    and project.archived_at is null
  order by project.created_at desc, project.id
  limit safe_limit;
end;
$$;

create or replace function public.app_get_my_client_project(p_project_id uuid)
returns table (
  id uuid,
  order_number bigint,
  title text,
  status text,
  created_at timestamptz,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  service_name text,
  task_total integer,
  task_open integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_company_id uuid;
begin
  perform public.app_require_module_access('portal_projects');
  perform private.require_permission('projects.view');

  actor_company_id := private.current_user_company_id();
  if actor_company_id is null then
    raise exception 'Project access is denied' using errcode = '42501';
  end if;

  return query
  select
    project.id,
    project.order_number,
    project.title,
    project.status,
    project.created_at,
    project.due_at,
    project.started_at,
    project.completed_at,
    service_row.name,
    coalesce(task_counts.task_total, 0),
    coalesce(task_counts.task_open, 0)
  from public.orders as project
  left join public.services as service_row
    on service_row.id = project.service_id
  left join lateral (
    select
      count(*)::integer as task_total,
      count(*) filter (
        where task.status in ('todo', 'in_progress', 'blocked')
      )::integer as task_open
    from public.order_tasks as task
    where task.order_id = project.id
      and task.archived_at is null
  ) as task_counts on true
  where project.id = p_project_id
    and project.company_id = actor_company_id
    and project.archived_at is null;
end;
$$;

revoke all on function public.app_list_my_client_projects(integer)
from public, anon, service_role;
revoke all on function public.app_get_my_client_project(uuid)
from public, anon, service_role;
grant execute on function public.app_list_my_client_projects(integer)
to authenticated;
grant execute on function public.app_get_my_client_project(uuid)
to authenticated;

-- =============================================================================
-- H-02: Services module and capability enforcement
-- =============================================================================

alter table public.services
  drop constraint if exists services_image_url_not_blank;

alter table public.services
  add constraint services_image_url_safe_http
  check (
    image_url is null
    or (
      image_url = btrim(image_url)
      and octet_length(image_url) <= 2048
      and image_url ~* '^https?://[^[:space:][:cntrl:]]+$'
    )
  );

create or replace function public.app_create_service_folder(
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
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

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

create or replace function public.app_update_service_folder(
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
  perform public.app_require_module_access('services');
  perform private.require_permission('services.edit');

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'description', 'parent_id', 'sort_order'] <> '{}'::jsonb
  then
    raise exception 'invalid service folder update patch'
      using errcode = '22023';
  end if;

  update public.service_folders
  set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
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

create or replace function public.app_archive_service_folder(p_folder_id uuid)
returns public.service_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_row public.service_folders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.archive');

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

create or replace function public.app_create_service(
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
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

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
  perform public.app_require_module_access('services');
  perform private.require_permission('services.edit');

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
  set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
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

create or replace function public.app_duplicate_service(
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
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

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

create or replace function public.app_archive_service(p_service_id uuid)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_row public.services;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.archive');

  select service.* into service_row
  from public.services as service
  where service.id = p_service_id
  for update;

  if service_row.id is null then raise no_data_found; end if;
  if service_row.archived_at is not null then return service_row; end if;

  update public.services
  set archived_at = now(), is_active = false
  where id = p_service_id
  returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.archived',
    format('Archived service %s.', service_row.name)
  );
  return service_row;
end;
$$;

-- =============================================================================
-- H-04: invoice-module authorization for wallet context and settlement
-- =============================================================================

drop policy if exists wf_card_memberships_authorized_select
on public.wf_card_memberships;

create policy wf_card_memberships_authorized_select
on public.wf_card_memberships
for select
to authenticated
using (
  (
    company_id = (select private.current_user_company_id())
    and public.app_has_permission('invoices.view')
  )
  or (
    (select private.is_internal_user())
    and public.app_has_permission('client_private.read')
  )
);

create or replace function public.app_get_company_wallet(p_company_id uuid)
returns public.company_wallets
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_row public.company_wallets;
begin
  if private.current_account_class() = 'client' then
    perform public.app_require_module_access('portal_invoices');
    perform private.require_permission('invoices.view');
  end if;

  perform private.require_client_private_company_access(p_company_id);

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  join public.companies as company_row
    on company_row.id = wallet.company_id
  where wallet.company_id = p_company_id
    and company_row.archived_at is null;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  return wallet_row;
end;
$$;

create or replace function public.app_pay_invoice_with_wallet(
  p_request_id uuid,
  p_invoice_id uuid
)
returns table (
  payment_id uuid,
  wallet_transaction_id uuid,
  wallet_balance_cents bigint,
  invoice_balance_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id);
  existing_id uuid;
  invoice_row public.invoices;
  wallet_row public.company_wallets;
  payment_row public.invoice_payments;
  wallet_transaction_row public.company_wallet_transactions;
  amounts record;
  debit_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null then
    raise exception 'WF_CARD_INVALID_PAYMENT_REQUEST' using errcode = '22023';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id
   and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Reauthorize before the idempotency lookup. A payment made while access was
  -- granted must not remain readable/replayable after invoices.view is denied.
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  existing_id := private.find_create_request(
    actor_id,
    'invoice.wallet.pay',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    where payment.id = existing_id;

    select transaction.* into wallet_transaction_row
    from public.company_wallet_transactions as transaction
    where transaction.invoice_payment_id = existing_id;

    select * into amounts
    from private.invoice_amounts(payment_row.invoice_id);

    if payment_row.id is null or wallet_transaction_row.id is null then
      raise no_data_found;
    end if;

    return query
    select
      payment_row.id,
      wallet_transaction_row.id,
      wallet_transaction_row.balance_after_cents,
      amounts.balance_due_cents;
    return;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.archived_at is null
  for update;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  debit_cents := amounts.balance_due_cents;
  if debit_cents is null or debit_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.wf_card_memberships as membership
    where membership.company_id = actor_company_id
      and membership.status = 'active'
  ) then
    raise exception 'WF_CARD_MEMBERSHIP_REQUIRED' using errcode = 'P0001';
  end if;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> invoice_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < debit_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    p_invoice_id,
    debit_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - debit_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id,
    request_id,
    actor_profile_id,
    amount_cents,
    balance_after_cents,
    currency,
    source,
    reason,
    invoice_id,
    invoice_payment_id
  ) values (
    actor_company_id,
    p_request_id,
    actor_id,
    -debit_cents,
    wallet_row.balance_cents,
    wallet_row.currency,
    'invoice_payment',
    format('WF Card payment for invoice #%s', invoice_row.invoice_number),
    invoice_row.id,
    payment_row.id
  ) returning * into wallet_transaction_row;

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  insert into public.activity_events (
    actor_profile_id,
    entity_type,
    entity_id,
    action,
    summary,
    metadata
  ) values (
    actor_id,
    'company',
    actor_company_id,
    'company.wallet_invoice_paid',
    'Paid an invoice with WF Card.',
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'wallet_transaction_id', wallet_transaction_row.id,
      'amount_cents', debit_cents,
      'balance_after_cents', wallet_row.balance_cents,
      'currency', wallet_row.currency
    )
  );

  perform private.remember_create_request(
    actor_id,
    'invoice.wallet.pay',
    p_request_id,
    request_payload,
    payment_row.id
  );

  select * into amounts from private.invoice_amounts(p_invoice_id);
  return query
  select
    payment_row.id,
    wallet_transaction_row.id,
    wallet_row.balance_cents,
    amounts.balance_due_cents;
end;
$$;

create or replace function private.emit_company_client_notification_for_permission(
  p_company_id uuid,
  p_required_permission_key text,
  p_event_key text,
  p_category text,
  p_variant text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_profile_id uuid,
  p_created_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at
  )
  select
    profile_row.id,
    p_company_id,
    'client',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now())
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  where role_row.name = 'client'
    and profile_row.archived_at is null
    and profile_row.company_id = p_company_id
    and private.profile_has_permission(
      profile_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

revoke all on function private.emit_company_client_notification_for_permission(
  uuid, text, text, text, text, text, text, text, text, uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

create or replace function private.notify_client_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  amount_label text;
begin
  if new.status is distinct from 'unpaid'
    or old.status is not distinct from 'unpaid'
  then
    return new;
  end if;

  amount_label := new.currency || ' '
    || to_char(new.total_cents / 100.0, 'FM999999990.00');

  perform private.emit_company_client_notification_for_permission(
    new.company_id,
    'invoices.view',
    'client-invoice-issued:' || new.id::text,
    'payment',
    'debit',
    case
      when new.invoice_number is null then 'New invoice'
      else 'Invoice #WF-' || lpad(new.invoice_number::text, 4, '0')
    end,
    amount_label
      || case
           when new.due_at is null then ' is ready to view.'
           else ' is due ' || to_char(new.due_at, 'FMMon FMDD') || '.'
         end,
    '/account/invoices/' || new.id::text,
    'invoice',
    new.id,
    (select auth.uid()),
    now()
  );

  return new;
end;
$$;

create or replace function private.notify_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  actor_id uuid := nullif(payload ->> 'actor_profile_id', '')::uuid;
  amount_cents bigint := coalesce(nullif(payload ->> 'amount_cents', '')::bigint, 0);
  currency text := coalesce(nullif(payload ->> 'currency', ''), 'USD');
  reason_value text := nullif(payload ->> 'reason', '');
  actor_role text;
  company_name text;
  amount_label text;
begin
  if amount_cents <= 0 or company_id is null then
    return new;
  end if;

  if actor_id is not null then
    select role_row.name into actor_role
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = actor_id;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = company_id;

  amount_label := currency || ' '
    || to_char(amount_cents::numeric / 100, 'FM999999999999990.00');

  perform private.emit_internal_notification(
    'wallet-credit-internal:' || new.id::text,
    'wallet',
    'credit',
    case
      when actor_role = 'client' then 'Client recharged wallet'
      else 'Client wallet credited'
    end,
    coalesce(company_name, 'Client') || ' received ' || amount_label
      || case
           when reason_value is null then '.'
           else '. ' || reason_value
         end,
    '/clients/' || company_id::text,
    'company',
    company_id,
    actor_id,
    company_id,
    now()
  );

  perform private.emit_company_client_notification_for_permission(
    company_id,
    'invoices.view',
    'wallet-credit-client:' || new.id::text,
    'wallet',
    'credit',
    amount_label || ' added to your wallet',
    case
      when actor_role = 'client' then 'Your wallet recharge was recorded.'
      else 'Wolf Forge added funds to your account.'
    end,
    '/account',
    'company',
    company_id,
    actor_id,
    now()
  );

  return new;
end;
$$;

-- =============================================================================
-- H-05: portal Forms module and profile-owned assignment/submission boundary
-- =============================================================================

drop policy if exists form_assignments_authorized_select
on public.form_assignments;

create policy form_assignments_authorized_select
on public.form_assignments
for select
to authenticated
using (
  (
    (select private.is_internal_user())
    and (
      public.app_has_permission('forms.assign')
      or public.app_has_permission('forms.submissions_view')
    )
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('forms.view')
    and company_id = (select private.current_user_company_id())
    and client_profile_id = (select auth.uid())
  )
);

drop policy if exists form_submissions_authorized_select
on public.form_submissions;

create policy form_submissions_authorized_select
on public.form_submissions
for select
to authenticated
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('forms.submissions_view')
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('forms.view')
    and company_id = (select private.current_user_company_id())
    and client_profile_id = (select auth.uid())
  )
);

-- The canonical published-schema reader is also used by assigned onboarding
-- routes. Public Order/Contact Forms remain anonymously readable, while an
-- assigned Form now requires the exact assignee profile rather than any member
-- of the assignee's company.
create or replace function public.app_get_published_form_schema(p_canonical_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  active_actor boolean := false;
  client_access boolean := false;
  internal_access boolean := false;
  form_row public.forms;
  version_row public.form_versions;
  result jsonb;
begin
  select exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = actor_id
      and profile_row.archived_at is null
  ) into active_actor;

  client_access := (select private.is_client_user());
  internal_access := (select private.is_internal_user());

  select form.* into form_row
  from public.forms as form
  where form.canonical_key = lower(p_canonical_key)
    and form.status = 'published'
    and form.archived_at is null;
  if form_row.id is null then raise no_data_found; end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = form_row.published_version_id;

  if form_row.visibility = 'public' then
    null;
  else
    if not active_actor then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;

    if client_access then
      perform public.app_require_module_access('portal_forms');
      perform private.require_permission('forms.view');
      actor_company_id := private.current_user_company_id();
      if actor_company_id is null then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    elsif not internal_access then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if form_row.visibility = 'assigned' then
      if client_access and not exists (
        select 1
        from public.form_assignments as assignment
        where assignment.form_id = form_row.id
          and assignment.form_version_id = version_row.id
          and assignment.status = 'assigned'
          and assignment.company_id = actor_company_id
          and assignment.client_profile_id = actor_id
          and assignment.archived_at is null
      ) then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      elsif internal_access
        and not private.current_user_has_permission('forms.view')
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  select jsonb_build_object(
    'form_id', form_row.id,
    'form_type', form_row.form_type,
    'canonical_key', form_row.canonical_key,
    'form_version_id', version_row.id,
    'version_number', version_row.version_number,
    'schema_hash', version_row.schema_hash,
    'title', version_row.title,
    'information_html', version_row.information_html,
    'visibility', version_row.visibility,
    'type_config', version_row.type_config,
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stable_field_key', field.stable_field_key,
        'sort_order', field.sort_order,
        'field_type', field.field_type,
        'label', field.label,
        'placeholder', field.placeholder,
        'help_html', field.help_html,
        'default_value', field.default_value,
        'required', field.required,
        'settings', field.settings,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'option_id', option.stable_option_key,
            'value', option.option_value,
            'label', option.label,
            'sort_order', option.sort_order,
            'metadata', option.metadata
          ) order by option.sort_order)
          from public.form_field_options as option
          where option.form_version_field_id = field.id
        ), '[]'::jsonb),
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
            'service_id', link.service_id,
            'role', link.role,
            'sort_order', link.sort_order,
            'configuration', link.configuration,
            'name', link.service_name_snapshot,
            'currency', link.service_currency_snapshot,
            'price_cents', link.service_price_cents_snapshot
          ) order by link.sort_order)
          from public.form_service_links as link
          where link.form_version_field_id = field.id
        ), '[]'::jsonb)
      ) order by field.sort_order)
      from public.form_version_fields as field
      where field.form_version_id = version_row.id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rule_key', rule.rule_key,
        'sort_order', rule.sort_order,
        'conditions', rule.conditions,
        'action', rule.action,
        'target_field_keys', rule.target_field_keys
      ) order by rule.sort_order)
      from public.form_rules as rule
      where rule.form_version_id = version_row.id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.app_list_assigned_forms()
returns table (
  assignment_id uuid,
  form_id uuid,
  form_type text,
  form_version_id uuid,
  version_number integer,
  title text,
  status text,
  required boolean,
  due_at timestamptz,
  assigned_at timestamptz,
  completed_at timestamptz,
  company_id uuid,
  company_name text,
  client_profile_id uuid,
  client_name text,
  order_id uuid,
  order_number bigint,
  order_title text,
  latest_submission_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;

  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  client_access := (select private.is_client_user());

  if client_access then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  return query
  select
    assignment.id,
    form.id,
    form.form_type,
    version.id,
    version.version_number,
    version.title,
    assignment.status,
    assignment.required,
    assignment.due_at,
    assignment.assigned_at,
    assignment.completed_at,
    company.id,
    company.name,
    client.id,
    client.display_name,
    work.id,
    work.order_number,
    work.title,
    assignment.latest_submission_id
  from public.form_assignments as assignment
  join public.forms as form on form.id = assignment.form_id
  join public.form_versions as version on version.id = assignment.form_version_id
  join public.companies as company on company.id = assignment.company_id
  left join public.profiles as client on client.id = assignment.client_profile_id
  left join public.orders as work on work.id = assignment.order_id
  where assignment.archived_at is null
    and (
      internal_access
      or (
        assignment.company_id = client_company_id
        and assignment.client_profile_id = actor.id
      )
    )
  order by
    (assignment.status = 'assigned') desc,
    assignment.due_at nulls last,
    assignment.assigned_at desc;
end;
$$;

create or replace function public.app_get_assigned_form_schema(
  p_assignment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  assignment public.form_assignments;
  form_row public.forms;
  version_row public.form_versions;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;
  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  client_access := (select private.is_client_user());

  if client_access then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  select * into assignment
  from public.form_assignments
  where id = p_assignment_id
    and archived_at is null;
  if assignment.id is null then raise no_data_found; end if;

  if client_access and not (
    client_company_id = assignment.company_id
    and actor.id = assignment.client_profile_id
  ) then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  select * into form_row
  from public.forms
  where id = assignment.form_id;
  select * into version_row
  from public.form_versions
  where id = assignment.form_version_id;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'assignment_id', assignment.id,
      'form_id', assignment.form_id,
      'form_type', form_row.form_type,
      'form_version_id', assignment.form_version_id,
      'version_number', version_row.version_number,
      'title', version_row.title,
      'status', assignment.status,
      'required', assignment.required,
      'due_at', assignment.due_at,
      'assigned_at', assignment.assigned_at,
      'completed_at', assignment.completed_at,
      'company_id', assignment.company_id,
      'company_name', (select name from public.companies where id = assignment.company_id),
      'client_profile_id', assignment.client_profile_id,
      'client_name', (select display_name from public.profiles where id = assignment.client_profile_id),
      'order_id', assignment.order_id,
      'order_number', (select order_number from public.orders where id = assignment.order_id),
      'order_title', (select title from public.orders where id = assignment.order_id),
      'latest_submission_id', assignment.latest_submission_id
    ),
    'schema', jsonb_build_object(
      'form_id', form_row.id,
      'form_type', form_row.form_type,
      'canonical_key', form_row.canonical_key,
      'form_version_id', version_row.id,
      'version_number', version_row.version_number,
      'schema_hash', version_row.schema_hash,
      'title', version_row.title,
      'information_html', version_row.information_html,
      'visibility', version_row.visibility,
      'type_config', version_row.type_config,
      'fields', coalesce((
        select jsonb_agg(jsonb_build_object(
          'stable_field_key', field.stable_field_key,
          'sort_order', field.sort_order,
          'field_type', field.field_type,
          'label', field.label,
          'placeholder', field.placeholder,
          'help_html', field.help_html,
          'default_value', field.default_value,
          'required', field.required,
          'settings', field.settings,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object(
              'option_id', option.stable_option_key,
              'value', option.option_value,
              'label', option.label,
              'sort_order', option.sort_order,
              'metadata', option.metadata
            ) order by option.sort_order)
            from public.form_field_options as option
            where option.form_version_field_id = field.id
          ), '[]'::jsonb),
          'services', coalesce((
            select jsonb_agg(jsonb_build_object(
              'service_id', link.service_id,
              'role', link.role,
              'sort_order', link.sort_order,
              'configuration', link.configuration,
              'name', link.service_name_snapshot,
              'currency', link.service_currency_snapshot,
              'price_cents', link.service_price_cents_snapshot
            ) order by link.sort_order)
            from public.form_service_links as link
            where link.form_version_field_id = field.id
          ), '[]'::jsonb)
        ) order by field.sort_order)
        from public.form_version_fields as field
        where field.form_version_id = version_row.id
      ), '[]'::jsonb),
      'rules', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rule_key', rule.rule_key,
          'sort_order', rule.sort_order,
          'conditions', rule.conditions,
          'action', rule.action,
          'target_field_keys', rule.target_field_keys
        ) order by rule.sort_order)
        from public.form_rules as rule
        where rule.form_version_id = version_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.app_get_form_submission(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  submission_row public.form_submissions;
  actor_profile public.profiles;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
  result jsonb;
begin
  select * into actor_profile
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;
  if actor_profile.id is null then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user())
    and private.current_user_has_permission('forms.submissions_view');
  client_access := (select private.is_client_user());

  if client_access then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form submission access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  select * into submission_row
  from public.form_submissions
  where id = p_submission_id;
  if submission_row.id is null then raise no_data_found; end if;

  if client_access and not (
    client_company_id = submission_row.company_id
    and actor_profile.id = submission_row.client_profile_id
  ) then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'submission', to_jsonb(submission_row),
    'values', coalesce(jsonb_agg(jsonb_build_object(
      'stable_field_key', value.stable_field_key,
      'label', value.field_label_snapshot,
      'field_type', value.field_type_snapshot,
      'sort_order', value.sort_order_snapshot,
      'value', value.value
    ) order by value.sort_order_snapshot)
      filter (
        where value.id is not null
          and value.field_type_snapshot <> 'secret'
      ), '[]'::jsonb)
  ) into result
  from public.form_submission_values as value
  where value.submission_id = submission_row.id;

  return result;
end;
$$;

create or replace function private.emit_client_profile_notification_for_permission(
  p_profile_id uuid,
  p_company_id uuid,
  p_required_permission_key text,
  p_event_key text,
  p_category text,
  p_variant text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_profile_id uuid,
  p_created_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at
  )
  select
    profile_row.id,
    p_company_id,
    'client',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now())
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  where profile_row.id = p_profile_id
    and profile_row.company_id = p_company_id
    and profile_row.archived_at is null
    and role_row.name = 'client'
    and private.profile_has_permission(
      profile_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

revoke all on function private.emit_client_profile_notification_for_permission(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

create or replace function private.notify_client_form_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_title text;
  form_kind text;
begin
  if new.status is distinct from 'assigned' then
    return new;
  end if;

  select version.title, form.form_type
  into form_title, form_kind
  from public.form_versions as version
  join public.forms as form on form.id = version.form_id
  where version.id = new.form_version_id;

  if form_kind is null or form_kind not in ('intake', 'onboarding') then
    return new;
  end if;

  perform private.emit_client_profile_notification_for_permission(
    new.client_profile_id,
    new.company_id,
    'forms.view',
    'client-form-assigned:' || new.id::text,
    'form',
    'info',
    'New onboarding item',
    coalesce(nullif(form_title, ''), 'Wolf Forge needs some information')
      || case
           when new.due_at is null then ' is ready for you to complete.'
           else ' is due ' || to_char(new.due_at, 'FMMon FMDD') || '.'
         end,
    '/account/onboarding/' || new.id::text,
    'form_assignment',
    new.id,
    (select auth.uid()),
    now()
  );

  return new;
end;
$$;

create or replace function public.app_submit_form(
  p_request_id uuid,
  p_form_version_id uuid,
  p_context jsonb,
  p_values jsonb,
  p_files jsonb default '[]'::jsonb
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_role text;
  actor_company_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  assignment_row public.form_assignments;
  submission_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  company_id_value uuid;
  client_profile_id_value uuid;
  order_id_value uuid;
  orchestration_type_value text;
  orchestration_status_value text := 'not_required';
  existing_id uuid;
  request_payload jsonb := jsonb_build_object(
    'form_version_id', p_form_version_id,
    'context', coalesce(p_context, '{}'::jsonb),
    'values', p_values,
    'files', coalesce(p_files, '[]'::jsonb)
  );
begin
  if p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or p_context - array[
      'assignment_id', 'order_id', 'company_id', 'client_profile_id'
    ] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then
    raise exception 'Form file upload storage boundary is not available'
      using errcode = '55000';
  end if;

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id
      and profile.archived_at is null;

    if actor_profile.id is null then
      raise exception 'active Form submitter is required' using errcode = '42501';
    end if;

    select role_row.name into actor_role
    from public.roles as role_row
    where role_row.id = actor_profile.role_id;
  end if;

  -- Every authenticated client submission reauthorizes the portal module
  -- before the idempotency lookup, so revoking Forms access is immediate.
  if actor_role = 'client' then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');

    actor_company_id := private.current_user_company_id();
    if actor_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    -- An assigned retry is allowed after completion, but only for the exact
    -- profile that owns the assignment. This check therefore intentionally
    -- does not require status = assigned.
    if p_context ? 'assignment_id' then
      select assignment.* into assignment_row
      from public.form_assignments as assignment
      where assignment.id = (p_context ->> 'assignment_id')::uuid
        and assignment.archived_at is null;

      if assignment_row.id is null
        or assignment_row.company_id <> actor_company_id
        or assignment_row.client_profile_id <> actor_id
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  existing_id := private.find_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload
  );
  if existing_id is not null then
    select * into submission_row
    from public.form_submissions
    where id = existing_id;
    if submission_row.id is null then raise no_data_found; end if;
    return submission_row;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.lifecycle_state = 'published'
  for share;
  if version_row.id is null then raise no_data_found; end if;

  select form.* into form_row
  from public.forms as form
  where form.id = version_row.form_id
    and form.status = 'published'
    and form.archived_at is null
    and form.published_version_id = version_row.id
  for share;
  if form_row.id is null then
    raise exception 'Form version is unavailable for submission'
      using errcode = '55000';
  end if;

  if form_row.visibility = 'public' then
    if form_row.form_type not in ('order', 'contact') then
      raise exception 'assigned Form cannot be public' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'assigned' then
    if actor_id is null or not p_context ? 'assignment_id' then
      raise exception 'Form assignment is required' using errcode = '42501';
    end if;
  end if;

  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;

    if assignment_row.id is null then
      raise exception 'active Form assignment is required' using errcode = '42501';
    end if;

    if actor_role = 'client' and (
      actor_company_id <> assignment_row.company_id
      or actor_id <> assignment_row.client_profile_id
    ) then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if actor_role <> 'client'
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;

    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    if actor_role = 'client' then
      company_id_value := actor_company_id;
      client_profile_id_value := actor_profile.id;
    elsif actor_id is not null
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;
  end if;

  if p_context ? 'company_id'
    and (p_context ->> 'company_id')::uuid is distinct from company_id_value
  then
    raise exception 'Form company context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'client_profile_id'
    and (p_context ->> 'client_profile_id')::uuid is distinct from client_profile_id_value
  then
    raise exception 'Form client context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'order_id'
    and (p_context ->> 'order_id')::uuid is distinct from order_id_value
  then
    raise exception 'Form Order context cannot be spoofed' using errcode = '42501';
  end if;

  perform private.validate_form_submission_values(version_row.id, p_values);

  if form_row.form_type = 'order' then
    orchestration_type_value := 'order_checkout';
    orchestration_status_value := 'deferred';
  elsif form_row.form_type = 'contact' then
    orchestration_type_value := 'contact_ticket';
    orchestration_status_value := 'deferred';
  end if;

  submission_row.id := gen_random_uuid();
  insert into public.form_submissions (
    id,
    form_id,
    form_version_id,
    form_assignment_id,
    company_id,
    client_profile_id,
    order_id,
    root_submission_id,
    revision_number,
    orchestration_type,
    orchestration_status,
    submitted_by_profile_id,
    provenance
  ) values (
    submission_row.id,
    form_row.id,
    version_row.id,
    assignment_row.id,
    company_id_value,
    client_profile_id_value,
    order_id_value,
    submission_row.id,
    1,
    orchestration_type_value,
    orchestration_status_value,
    actor_id,
    jsonb_build_object(
      'form_type', form_row.form_type,
      'schema_hash', version_row.schema_hash,
      'type_config', version_row.type_config,
      'orchestration_deferred', orchestration_status_value = 'deferred'
    )
  ) returning * into submission_row;

  for submitted_value in
    select value from jsonb_array_elements(p_values)
  loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;

    insert into public.form_submission_values (
      submission_id,
      form_version_field_id,
      stable_field_key,
      field_label_snapshot,
      field_type_snapshot,
      sort_order_snapshot,
      value
    ) values (
      submission_row.id,
      field_row.id,
      field_row.stable_field_key,
      field_row.label,
      field_row.field_type,
      field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if assignment_row.id is not null then
    update public.form_assignments
    set
      status = 'completed',
      completed_at = now(),
      latest_submission_id = submission_row.id
    where id = assignment_row.id;
  end if;

  perform private.record_form_activity(
    'form_submission',
    submission_row.id,
    'form.submitted',
    format('Submitted %s Form.', initcap(form_row.form_type)),
    jsonb_build_object(
      'form_id', form_row.id,
      'form_version_id', version_row.id,
      'assignment_id', assignment_row.id,
      'company_id', company_id_value,
      'order_id', order_id_value
    )
  );
  perform private.remember_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload,
    submission_row.id
  );
  return submission_row;
end;
$$;

comment on function public.app_list_client_company_directory()
is 'Permission-gated internal client-directory DTO. Excludes client-private fields and Stripe identity.';

comment on function public.app_list_my_client_projects(integer)
is 'Caller-company Project list for portal clients. Requires portal_projects and exposes only client-safe Project fields plus aggregate task counts.';

comment on function public.app_get_my_client_project(uuid)
is 'Caller-company Project detail for portal clients. Foreign, archived, or unavailable IDs return no rows.';
