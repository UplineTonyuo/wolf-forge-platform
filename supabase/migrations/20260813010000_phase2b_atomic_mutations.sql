-- Wolf Forge Platform - Phase 2B atomic user mutation boundary
-- The authenticated RPCs are narrow SECURITY DEFINER entry points so their
-- private activity helper is never directly callable by API roles. The helper
-- verifies an active internal profile on every call; all objects are schema
-- qualified and the search path is empty. Each RPC performs its mutation and
-- activity insert in one transaction and derives the actor from auth.uid().

create or replace function private.require_internal_actor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not (select private.is_internal_user()) then
    raise exception 'verified internal authentication is required'
      using errcode = '42501';
  end if;
  return actor_id;
end;
$$;

create or replace function private.record_authenticated_activity(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.activity_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.activity_events;
  actor_id uuid := private.require_internal_actor();
begin
  insert into public.activity_events (
    actor_profile_id,
    entity_type,
    entity_id,
    action,
    summary,
    metadata
  )
  values (
    actor_id,
    p_entity_type,
    p_entity_id,
    p_action,
    p_summary,
    p_metadata
  )
  returning * into event_row;

  return event_row;
end;
$$;

create or replace function public.app_create_company(p_name text)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
begin
  perform private.require_internal_actor();
  insert into public.companies (name)
  values (p_name)
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company', company_row.id, 'company.created',
    format('Created client %s.', company_row.name)
  );
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
  update public.companies
  set archived_at = now()
  where id = p_company_id
  returning * into company_row;
  if company_row.id is null then raise no_data_found; end if;

  perform private.record_authenticated_activity(
    'company', company_row.id, 'company.archived',
    format('Archived client %s.', company_row.name)
  );
  return company_row;
end;
$$;

create or replace function public.app_create_contact(
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
  contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  insert into public.client_contacts (
    company_id, profile_id, name, email, phone, job_title, is_primary
  )
  values (
    p_company_id, p_profile_id, p_name, p_email, p_phone, p_job_title, p_is_primary
  )
  returning * into contact_row;

  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.created',
    format('Created client contact %s.', contact_row.name),
    jsonb_build_object('company_id', contact_row.company_id)
  );
  return contact_row;
end;
$$;

create or replace function public.app_archive_contact(p_contact_id uuid)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  update public.client_contacts
  set archived_at = now(), is_primary = false
  where id = p_contact_id
  returning * into contact_row;
  if contact_row.id is null then raise no_data_found; end if;

  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.archived',
    format('Archived client contact %s.', contact_row.name)
  );
  return contact_row;
end;
$$;

create or replace function public.app_create_service(
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
  service_row public.services;
begin
  perform private.require_internal_actor();
  insert into public.services (name, description, is_active)
  values (p_name, p_description, p_is_active)
  returning * into service_row;

  perform private.record_authenticated_activity(
    'service', service_row.id, 'service.created',
    format('Created service %s.', service_row.name)
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
  update public.services
  set archived_at = now(), is_active = false
  where id = p_service_id
  returning * into service_row;
  if service_row.id is null then raise no_data_found; end if;

  perform private.record_authenticated_activity(
    'service', service_row.id, 'service.archived',
    format('Archived service %s.', service_row.name)
  );
  return service_row;
end;
$$;

create or replace function public.app_create_order(
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
  order_row public.orders;
begin
  perform private.require_internal_actor();
  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title,
    priority, due_at, started_at, notes
  )
  values (
    p_company_id, p_service_id, p_assigned_to_profile_id, p_title,
    p_priority, p_due_at, p_started_at, p_notes
  )
  returning * into order_row;

  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.created',
    format('Created project %s: %s.', order_row.order_number, order_row.title),
    jsonb_build_object('company_id', order_row.company_id, 'service_id', order_row.service_id)
  );
  return order_row;
end;
$$;

create or replace function public.app_change_order_status(
  p_order_id uuid,
  p_status text,
  p_completed_at timestamptz default null
)
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
  select status into previous_status
  from public.orders
  where id = p_order_id
  for update;
  if previous_status is null then raise no_data_found; end if;

  update public.orders
  set status = p_status,
      completed_at = case
        when p_status = 'complete' then coalesce(p_completed_at, now())
        else null
      end
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

create or replace function public.app_assign_order(
  p_order_id uuid,
  p_assigned_to_profile_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
begin
  perform private.require_internal_actor();
  update public.orders
  set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_order_id
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

create or replace function public.app_archive_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
begin
  perform private.require_internal_actor();
  update public.orders
  set archived_at = now()
  where id = p_order_id
  returning * into order_row;
  if order_row.id is null then raise no_data_found; end if;

  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.archived',
    format('Archived project %s.', order_row.order_number)
  );
  return order_row;
end;
$$;

create or replace function public.app_create_task(
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
  task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  insert into public.order_tasks (
    order_id, assigned_to_profile_id, title, description, due_at, sort_position
  )
  values (
    p_order_id, p_assigned_to_profile_id, p_title, p_description, p_due_at, p_sort_position
  )
  returning * into task_row;

  perform private.record_authenticated_activity(
    'order_task', task_row.id, 'task.created',
    format('Created project task %s.', task_row.title),
    jsonb_build_object('order_id', task_row.order_id)
  );
  return task_row;
end;
$$;

create or replace function public.app_change_task_status(
  p_task_id uuid,
  p_status text,
  p_completed_at timestamptz default null
)
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
  select status into previous_status
  from public.order_tasks
  where id = p_task_id
  for update;
  if previous_status is null then raise no_data_found; end if;

  update public.order_tasks
  set status = p_status,
      completed_at = case
        when p_status = 'complete' then coalesce(p_completed_at, now())
        else null
      end
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

create or replace function public.app_assign_task(
  p_task_id uuid,
  p_assigned_to_profile_id uuid default null
)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  update public.order_tasks
  set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_task_id
  returning * into task_row;
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

revoke all on function private.require_internal_actor()
from public, anon, authenticated, service_role;

revoke all on function private.record_authenticated_activity(text, uuid, text, text, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.app_create_company(text) from public, anon, service_role;
revoke all on function public.app_archive_company(uuid) from public, anon, service_role;
revoke all on function public.app_create_contact(uuid, text, uuid, text, text, text, boolean) from public, anon, service_role;
revoke all on function public.app_archive_contact(uuid) from public, anon, service_role;
revoke all on function public.app_create_service(text, text, boolean) from public, anon, service_role;
revoke all on function public.app_archive_service(uuid) from public, anon, service_role;
revoke all on function public.app_create_order(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text) from public, anon, service_role;
revoke all on function public.app_change_order_status(uuid, text, timestamptz) from public, anon, service_role;
revoke all on function public.app_assign_order(uuid, uuid) from public, anon, service_role;
revoke all on function public.app_archive_order(uuid) from public, anon, service_role;
revoke all on function public.app_create_task(uuid, text, uuid, text, timestamptz, integer) from public, anon, service_role;
revoke all on function public.app_change_task_status(uuid, text, timestamptz) from public, anon, service_role;
revoke all on function public.app_assign_task(uuid, uuid) from public, anon, service_role;

grant execute on function public.app_create_company(text) to authenticated;
grant execute on function public.app_archive_company(uuid) to authenticated;
grant execute on function public.app_create_contact(uuid, text, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.app_archive_contact(uuid) to authenticated;
grant execute on function public.app_create_service(text, text, boolean) to authenticated;
grant execute on function public.app_archive_service(uuid) to authenticated;
grant execute on function public.app_create_order(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.app_change_order_status(uuid, text, timestamptz) to authenticated;
grant execute on function public.app_assign_order(uuid, uuid) to authenticated;
grant execute on function public.app_archive_order(uuid) to authenticated;
grant execute on function public.app_create_task(uuid, text, uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.app_change_task_status(uuid, text, timestamptz) to authenticated;
grant execute on function public.app_assign_task(uuid, uuid) to authenticated;
