-- Retry keys prevent duplicate writes; they never retain access to a reassigned or archived row.
create or replace function public.app_create_order(p_request_id uuid, p_company_id uuid, p_service_id uuid, p_title text, p_assigned_to_profile_id uuid default null::uuid, p_priority text default 'normal'::text, p_due_at timestamp with time zone default null::timestamp with time zone, p_started_at timestamp with time zone default null::timestamp with time zone, p_notes text default null::text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $function$
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
  perform public.app_require_module_access('projects');
  existing_id := private.find_create_request(actor_id, 'order.create', p_request_id, request_payload);
  if existing_id is not null then
    select project.* into order_row from public.orders as project
    where project.id = existing_id and project.tenant_id = (select private.current_tenant_id())
      and project.archived_at is null and private.can_access_operational_order(project.id);
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
$function$;

create or replace function public.app_create_task(p_request_id uuid, p_order_id uuid, p_title text, p_assigned_to_profile_id uuid default null::uuid, p_description text default null::text, p_due_at timestamp with time zone default null::timestamp with time zone, p_sort_position integer default 0)
returns public.order_tasks
language plpgsql
security definer
set search_path = ''
as $function$
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
  perform public.app_require_module_access('projects');
  existing_id := private.find_create_request(actor_id, 'task.create', p_request_id, request_payload);
  if existing_id is not null then
    select task.* into task_row from public.order_tasks as task
    join public.orders as project on project.id = task.order_id and project.tenant_id = (select private.current_tenant_id())
    where task.id = existing_id and task.archived_at is null and project.archived_at is null
      and private.can_access_operational_task(task.id);
    if task_row.id is null then raise no_data_found; end if;
    return task_row;
  end if;

  if not exists (
    select 1 from public.orders as project
    where project.id = p_order_id and project.tenant_id = (select private.current_tenant_id()) and project.archived_at is null
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
$function$;
