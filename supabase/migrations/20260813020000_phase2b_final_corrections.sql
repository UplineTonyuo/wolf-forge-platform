-- Wolf Forge Platform - Phase 2B final correction pass
-- Authenticated users retain RLS-filtered reads, but operational writes are
-- restricted to the audited app_* transaction boundary.

create table private.app_create_requests (
  actor_profile_id uuid not null,
  operation text not null,
  request_id uuid not null,
  payload jsonb not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_profile_id, operation, request_id),
  constraint app_create_requests_operation_not_blank check (btrim(operation) <> ''),
  constraint app_create_requests_payload_is_object check (jsonb_typeof(payload) = 'object')
);

revoke all on table private.app_create_requests from public, anon, authenticated, service_role;

-- normalize_authenticated_activity_event is useful for direct authenticated
-- inserts because current_user is authenticated there. Inside SECURITY DEFINER
-- app_* functions current_user is the definer, so every RPC must instead derive
-- its actor directly from auth.uid() through require_internal_actor().
comment on function private.normalize_authenticated_activity_event() is
  'Does not normalize actors inside SECURITY DEFINER app_* functions because current_user is the definer; each RPC must derive its actor directly from auth.uid().';

create or replace function private.find_create_request(
  p_actor_profile_id uuid,
  p_operation text,
  p_request_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_request private.app_create_requests;
begin
  -- Serialize equal retry keys. Hash collisions only serialize unrelated calls.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_profile_id::text || ':' || p_operation || ':' || p_request_id::text,
      0
    )
  );

  select request.* into prior_request
  from private.app_create_requests as request
  where request.actor_profile_id = p_actor_profile_id
    and request.operation = p_operation
    and request.request_id = p_request_id;

  if prior_request.entity_id is not null and prior_request.payload <> p_payload then
    raise exception 'idempotency key was already used with different input'
      using errcode = '23505';
  end if;

  return prior_request.entity_id;
end;
$$;

create or replace function private.remember_create_request(
  p_actor_profile_id uuid,
  p_operation text,
  p_request_id uuid,
  p_payload jsonb,
  p_entity_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.app_create_requests (
    actor_profile_id, operation, request_id, payload, entity_id
  ) values (
    p_actor_profile_id, p_operation, p_request_id, p_payload, p_entity_id
  );
$$;

revoke all on function private.find_create_request(uuid, text, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.remember_create_request(uuid, text, uuid, jsonb, uuid)
from public, anon, authenticated, service_role;

-- Replace the pre-correction create/status signatures so PostgREST exposes only
-- the retry-safe create contract and server-timestamped completion contract.
drop function public.app_create_company(text);
drop function public.app_create_contact(uuid, text, uuid, text, text, text, boolean);
drop function public.app_create_service(text, text, boolean);
drop function public.app_create_order(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text);
drop function public.app_create_task(uuid, text, uuid, text, timestamptz, integer);
drop function public.app_change_order_status(uuid, text, timestamptz);
drop function public.app_change_task_status(uuid, text, timestamptz);

create function public.app_create_company(
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
  existing_id := private.find_create_request(actor_id, 'company.create', p_request_id, request_payload);
  if existing_id is not null then
    select company.* into company_row from public.companies as company where company.id = existing_id;
    if company_row.id is null then raise no_data_found; end if;
    return company_row;
  end if;

  insert into public.companies (name) values (p_name) returning * into company_row;
  perform private.record_authenticated_activity(
    'company', company_row.id, 'company.created',
    format('Created client %s.', company_row.name)
  );
  perform private.remember_create_request(actor_id, 'company.create', p_request_id, request_payload, company_row.id);
  return company_row;
end;
$$;

create function public.app_create_contact(
  p_request_id uuid,
  p_company_id uuid,
  p_name text,
  p_profile_id uuid default null,
  p_email text default null,
  p_phone text default null,
  p_job_title text default null,
  p_is_primary boolean default false
)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'company_id', p_company_id, 'name', p_name, 'profile_id', p_profile_id,
    'email', p_email, 'phone', p_phone, 'job_title', p_job_title,
    'is_primary', p_is_primary
  );
  existing_id uuid;
  contact_row public.client_contacts;
begin
  existing_id := private.find_create_request(actor_id, 'contact.create', p_request_id, request_payload);
  if existing_id is not null then
    select contact.* into contact_row from public.client_contacts as contact where contact.id = existing_id;
    if contact_row.id is null then raise no_data_found; end if;
    return contact_row;
  end if;

  insert into public.client_contacts (
    company_id, profile_id, name, email, phone, job_title, is_primary
  ) values (
    p_company_id, p_profile_id, p_name, p_email, p_phone, p_job_title, p_is_primary
  ) returning * into contact_row;
  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.created',
    format('Created client contact %s.', contact_row.name),
    jsonb_build_object('company_id', contact_row.company_id)
  );
  perform private.remember_create_request(actor_id, 'contact.create', p_request_id, request_payload, contact_row.id);
  return contact_row;
end;
$$;

create function public.app_create_service(
  p_request_id uuid,
  p_name text,
  p_description text default null,
  p_is_active boolean default true
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'name', p_name, 'description', p_description, 'is_active', p_is_active
  );
  existing_id uuid;
  service_row public.services;
begin
  existing_id := private.find_create_request(actor_id, 'service.create', p_request_id, request_payload);
  if existing_id is not null then
    select service.* into service_row from public.services as service where service.id = existing_id;
    if service_row.id is null then raise no_data_found; end if;
    return service_row;
  end if;

  insert into public.services (name, description, is_active)
  values (p_name, p_description, p_is_active)
  returning * into service_row;
  perform private.record_authenticated_activity(
    'service', service_row.id, 'service.created',
    format('Created service %s.', service_row.name)
  );
  perform private.remember_create_request(actor_id, 'service.create', p_request_id, request_payload, service_row.id);
  return service_row;
end;
$$;

create function public.app_create_order(
  p_request_id uuid,
  p_company_id uuid,
  p_service_id uuid,
  p_title text,
  p_assigned_to_profile_id uuid default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_started_at timestamptz default null,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'company_id', p_company_id, 'service_id', p_service_id, 'title', p_title,
    'assigned_to_profile_id', p_assigned_to_profile_id, 'priority', p_priority,
    'due_at', p_due_at, 'started_at', p_started_at, 'notes', p_notes
  );
  existing_id uuid;
  order_row public.orders;
begin
  existing_id := private.find_create_request(actor_id, 'order.create', p_request_id, request_payload);
  if existing_id is not null then
    select project.* into order_row from public.orders as project where project.id = existing_id;
    if order_row.id is null then raise no_data_found; end if;
    return order_row;
  end if;

  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title,
    priority, due_at, started_at, notes
  ) values (
    p_company_id, p_service_id, p_assigned_to_profile_id, p_title,
    p_priority, p_due_at, p_started_at, p_notes
  ) returning * into order_row;
  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.created',
    format('Created project %s: %s.', order_row.order_number, order_row.title),
    jsonb_build_object('company_id', order_row.company_id, 'service_id', order_row.service_id)
  );
  perform private.remember_create_request(actor_id, 'order.create', p_request_id, request_payload, order_row.id);
  return order_row;
end;
$$;

create function public.app_create_task(
  p_request_id uuid,
  p_order_id uuid,
  p_title text,
  p_assigned_to_profile_id uuid default null,
  p_description text default null,
  p_due_at timestamptz default null,
  p_sort_position integer default 0
)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'order_id', p_order_id, 'title', p_title,
    'assigned_to_profile_id', p_assigned_to_profile_id,
    'description', p_description, 'due_at', p_due_at,
    'sort_position', p_sort_position
  );
  existing_id uuid;
  task_row public.order_tasks;
begin
  existing_id := private.find_create_request(actor_id, 'task.create', p_request_id, request_payload);
  if existing_id is not null then
    select task.* into task_row from public.order_tasks as task where task.id = existing_id;
    if task_row.id is null then raise no_data_found; end if;
    return task_row;
  end if;

  if not exists (
    select 1 from public.orders as project
    where project.id = p_order_id and project.archived_at is null
  ) then
    raise no_data_found;
  end if;

  insert into public.order_tasks (
    order_id, assigned_to_profile_id, title, description, due_at, sort_position
  ) values (
    p_order_id, p_assigned_to_profile_id, p_title, p_description, p_due_at, p_sort_position
  ) returning * into task_row;
  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.created',
    format('Created project task %s.', task_row.title),
    jsonb_build_object('order_id', task_row.order_id)
  );
  perform private.remember_create_request(actor_id, 'task.create', p_request_id, request_payload, task_row.id);
  return task_row;
end;
$$;

create or replace function public.app_update_company(p_company_id uuid, p_patch jsonb)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare company_row public.companies;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['name'] <> '{}'::jsonb
  then raise exception 'invalid client update patch' using errcode = '22023'; end if;

  update public.companies
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end
  where id = p_company_id and archived_at is null
  returning * into company_row;
  if company_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'company', company_row.id, 'company.updated',
    format('Updated client %s.', company_row.name)
  );
  return company_row;
end;
$$;

create or replace function public.app_update_contact(p_contact_id uuid, p_patch jsonb)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['profile_id', 'name', 'email', 'phone', 'job_title', 'is_primary'] <> '{}'::jsonb
  then raise exception 'invalid client contact update patch' using errcode = '22023'; end if;

  update public.client_contacts
  set profile_id = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else profile_id end,
      name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      email = case when p_patch ? 'email' then p_patch ->> 'email' else email end,
      phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
      job_title = case when p_patch ? 'job_title' then p_patch ->> 'job_title' else job_title end,
      is_primary = case when p_patch ? 'is_primary' then (p_patch ->> 'is_primary')::boolean else is_primary end
  where id = p_contact_id and archived_at is null
  returning * into contact_row;
  if contact_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.updated',
    format('Updated client contact %s.', contact_row.name)
  );
  return contact_row;
end;
$$;

create or replace function public.app_update_service(p_service_id uuid, p_patch jsonb)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare service_row public.services;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['name', 'description', 'is_active'] <> '{}'::jsonb
  then raise exception 'invalid service update patch' using errcode = '22023'; end if;

  update public.services
  set name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
      is_active = case when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean else is_active end
  where id = p_service_id and archived_at is null
  returning * into service_row;
  if service_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'service', service_row.id, 'service.updated',
    format('Updated service %s.', service_row.name)
  );
  return service_row;
end;
$$;

create or replace function public.app_update_order(p_order_id uuid, p_patch jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['service_id', 'title', 'priority', 'due_at', 'started_at', 'notes'] <> '{}'::jsonb
  then raise exception 'invalid project update patch' using errcode = '22023'; end if;

  update public.orders
  set service_id = case when p_patch ? 'service_id' then (p_patch ->> 'service_id')::uuid else service_id end,
      title = case when p_patch ? 'title' then p_patch ->> 'title' else title end,
      priority = case when p_patch ? 'priority' then p_patch ->> 'priority' else priority end,
      due_at = case when p_patch ? 'due_at' then (p_patch ->> 'due_at')::timestamptz else due_at end,
      started_at = case when p_patch ? 'started_at' then (p_patch ->> 'started_at')::timestamptz else started_at end,
      notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else notes end
  where id = p_order_id and archived_at is null
  returning * into order_row;
  if order_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.updated',
    format('Updated project %s.', order_row.order_number)
  );
  return order_row;
end;
$$;

create or replace function public.app_update_task(p_task_id uuid, p_patch jsonb)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['title', 'description', 'due_at'] <> '{}'::jsonb
  then raise exception 'invalid task update patch' using errcode = '22023'; end if;

  update public.order_tasks as task
  set title = case when p_patch ? 'title' then p_patch ->> 'title' else task.title end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else task.description end,
      due_at = case when p_patch ? 'due_at' then (p_patch ->> 'due_at')::timestamptz else task.due_at end
  from public.orders as project
  where task.id = p_task_id
    and task.archived_at is null
    and project.id = task.order_id
    and project.archived_at is null
  returning task.* into task_row;
  if task_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.updated',
    format('Updated project task %s.', task_row.title)
  );
  return task_row;
end;
$$;

create or replace function public.app_reorder_task(p_task_id uuid, p_sort_position integer)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  update public.order_tasks as task
  set sort_position = p_sort_position
  from public.orders as project
  where task.id = p_task_id
    and task.archived_at is null
    and project.id = task.order_id
    and project.archived_at is null
  returning task.* into task_row;
  if task_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.updated',
    format('Reordered project task %s.', task_row.title),
    jsonb_build_object('sort_position', task_row.sort_position)
  );
  return task_row;
end;
$$;

create function public.app_change_order_status(p_order_id uuid, p_status text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
  previous_status text;
begin
  perform private.require_internal_actor();
  select project.status into previous_status
  from public.orders as project
  where project.id = p_order_id and project.archived_at is null
  for update;
  if previous_status is null then raise no_data_found; end if;

  update public.orders
  set status = p_status,
      completed_at = case when p_status = 'complete' then now() else null end
  where id = p_order_id
  returning * into order_row;
  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.status_changed',
    format('Changed project %s status from %s to %s.', order_row.order_number, previous_status, order_row.status),
    jsonb_build_object('from', previous_status, 'to', order_row.status)
  );
  return order_row;
end;
$$;

create function public.app_change_task_status(p_task_id uuid, p_status text)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.order_tasks;
  previous_status text;
begin
  perform private.require_internal_actor();
  select task.status into previous_status
  from public.order_tasks as task
  join public.orders as project on project.id = task.order_id
  where task.id = p_task_id
    and task.archived_at is null
    and project.archived_at is null
  for update of task;
  if previous_status is null then raise no_data_found; end if;

  update public.order_tasks
  set status = p_status,
      completed_at = case when p_status = 'complete' then now() else null end
  where id = p_task_id
  returning * into task_row;
  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.status_changed',
    format('Changed task status from %s to %s.', previous_status, task_row.status),
    jsonb_build_object('from', previous_status, 'to', task_row.status)
  );
  return task_row;
end;
$$;

create or replace function public.app_assign_order(
  p_order_id uuid,
  p_assigned_to_profile_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  update public.orders
  set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_order_id and archived_at is null
  returning * into order_row;
  if order_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.assigned',
    case when p_assigned_to_profile_id is null
      then format('Unassigned project %s.', order_row.order_number)
      else format('Assigned project %s.', order_row.order_number)
    end,
    jsonb_build_object('assigned_to_profile_id', p_assigned_to_profile_id)
  );
  return order_row;
end;
$$;

create or replace function public.app_assign_task(
  p_task_id uuid,
  p_assigned_to_profile_id uuid default null
)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  update public.order_tasks as task
  set assigned_to_profile_id = p_assigned_to_profile_id
  from public.orders as project
  where task.id = p_task_id
    and task.archived_at is null
    and project.id = task.order_id
    and project.archived_at is null
  returning task.* into task_row;
  if task_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.assigned',
    case when p_assigned_to_profile_id is null
      then format('Unassigned project task %s.', task_row.title)
      else format('Assigned project task %s.', task_row.title)
    end,
    jsonb_build_object('assigned_to_profile_id', p_assigned_to_profile_id)
  );
  return task_row;
end;
$$;

-- Archive is idempotent: a retry returns the existing archived row and writes
-- no second activity event. A genuinely missing row still raises 02000.
create or replace function public.app_archive_company(p_company_id uuid)
returns public.companies language plpgsql security definer set search_path = '' as $$
declare company_row public.companies;
begin
  perform private.require_internal_actor();
  select company.* into company_row from public.companies as company where company.id = p_company_id for update;
  if company_row.id is null then raise no_data_found; end if;
  if company_row.archived_at is not null then return company_row; end if;
  update public.companies set archived_at = now() where id = p_company_id returning * into company_row;
  perform private.record_authenticated_activity('company', company_row.id, 'company.archived', format('Archived client %s.', company_row.name));
  return company_row;
end;
$$;

create or replace function public.app_archive_contact(p_contact_id uuid)
returns public.client_contacts language plpgsql security definer set search_path = '' as $$
declare contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  select contact.* into contact_row from public.client_contacts as contact where contact.id = p_contact_id for update;
  if contact_row.id is null then raise no_data_found; end if;
  if contact_row.archived_at is not null then return contact_row; end if;
  update public.client_contacts set archived_at = now(), is_primary = false where id = p_contact_id returning * into contact_row;
  perform private.record_authenticated_activity('client_contact', contact_row.id, 'contact.archived', format('Archived client contact %s.', contact_row.name));
  return contact_row;
end;
$$;

create or replace function public.app_archive_service(p_service_id uuid)
returns public.services language plpgsql security definer set search_path = '' as $$
declare service_row public.services;
begin
  perform private.require_internal_actor();
  select service.* into service_row from public.services as service where service.id = p_service_id for update;
  if service_row.id is null then raise no_data_found; end if;
  if service_row.archived_at is not null then return service_row; end if;
  update public.services set archived_at = now(), is_active = false where id = p_service_id returning * into service_row;
  perform private.record_authenticated_activity('service', service_row.id, 'service.archived', format('Archived service %s.', service_row.name));
  return service_row;
end;
$$;

create or replace function public.app_archive_order(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  select project.* into order_row from public.orders as project where project.id = p_order_id for update;
  if order_row.id is null then raise no_data_found; end if;
  if order_row.archived_at is not null then return order_row; end if;
  update public.orders set archived_at = now() where id = p_order_id returning * into order_row;
  perform private.record_authenticated_activity('order', order_row.id, 'order.archived', format('Archived project %s.', order_row.order_number));
  return order_row;
end;
$$;

-- RLS remains the read boundary. Operational DML privileges are removed so a
-- valid authenticated JWT cannot bypass the RPC activity transaction.
revoke insert, update on table
  public.companies,
  public.client_contacts,
  public.services,
  public.orders,
  public.order_tasks
from authenticated;

drop policy if exists companies_internal_insert on public.companies;
drop policy if exists companies_internal_update on public.companies;
drop policy if exists client_contacts_internal_insert on public.client_contacts;
drop policy if exists client_contacts_internal_update on public.client_contacts;
drop policy if exists services_internal_insert on public.services;
drop policy if exists services_internal_update on public.services;
drop policy if exists orders_internal_insert on public.orders;
drop policy if exists orders_internal_update on public.orders;
drop policy if exists order_tasks_internal_insert on public.order_tasks;
drop policy if exists order_tasks_internal_update on public.order_tasks;

revoke all on function public.app_create_company(uuid, text) from public, anon, service_role;
revoke all on function public.app_create_contact(uuid, uuid, text, uuid, text, text, text, boolean) from public, anon, service_role;
revoke all on function public.app_create_service(uuid, text, text, boolean) from public, anon, service_role;
revoke all on function public.app_create_order(uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text) from public, anon, service_role;
revoke all on function public.app_create_task(uuid, uuid, text, uuid, text, timestamptz, integer) from public, anon, service_role;
revoke all on function public.app_update_company(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_update_contact(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_update_service(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_update_order(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_update_task(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_reorder_task(uuid, integer) from public, anon, service_role;
revoke all on function public.app_change_order_status(uuid, text) from public, anon, service_role;
revoke all on function public.app_change_task_status(uuid, text) from public, anon, service_role;

grant execute on function public.app_create_company(uuid, text) to authenticated;
grant execute on function public.app_create_contact(uuid, uuid, text, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.app_create_service(uuid, text, text, boolean) to authenticated;
grant execute on function public.app_create_order(uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.app_create_task(uuid, uuid, text, uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.app_update_company(uuid, jsonb) to authenticated;
grant execute on function public.app_update_contact(uuid, jsonb) to authenticated;
grant execute on function public.app_update_service(uuid, jsonb) to authenticated;
grant execute on function public.app_update_order(uuid, jsonb) to authenticated;
grant execute on function public.app_update_task(uuid, jsonb) to authenticated;
grant execute on function public.app_reorder_task(uuid, integer) to authenticated;
grant execute on function public.app_change_order_status(uuid, text) to authenticated;
grant execute on function public.app_change_task_status(uuid, text) to authenticated;
