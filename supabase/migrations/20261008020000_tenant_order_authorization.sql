-- WL-2.6 (KI-111, Orders / Projects / tasks): Order authorization is bound
-- to the current Tenant.
--
-- Concrete attack closed: private.can_access_operational_order and
-- private.can_access_operational_task granted any internal member of the
-- caller's current Tenant with client_private.read every Order / task by id,
-- whatever the Order's Tenant. Everything that routes through them inherited
-- the gap: the orders / order_tasks SELECT policies (Projects list, detail,
-- global search), the orders / order_tasks permission triggers (update,
-- assign, status, archive and task writes), and
-- private.require_order_conversation_access, which gates the Project
-- conversation (app_get_order_conversation, app_get_project_conversation,
-- app_send_order_message, app_reply_to_order_message,
-- app_toggle_order_message_reaction), Project attachments (preparation,
-- send, download) and client presence. The Order-linked Ticket side door
-- (an Order id leading to its linked Ticket's messages / attachments) closes
-- with it: the linked Ticket shares the Order's Tenant (composite FK) and the
-- Ticket functions it then calls are Tenant-bound since WL-2.5.
--
-- Pattern (D-272, no new helper): the helpers and every id lookup add
-- orders.tenant_id = private.current_tenant_id(), so a foreign Order or task
-- behaves like a missing one (no_data_found / 'Project not found'). Tasks,
-- Project messages, attachments and reactions inherit through order_id; no
-- tenant_id is added to them. Assignee eligibility stays with WL-2.4.
-- app_create_order / app_create_task replays return only rows of the current
-- Tenant. A new Order's Company and Service are held to the Order's Tenant by
-- the composite foreign keys. The client portal Project reads already resolve
-- the Company from the current Tenant's membership and now also check the
-- row's Tenant. app_assign_form's intake branch only attaches a Form to a
-- current-Tenant Order.
--
-- Not changed: app_purchase_service_with_balance (client identity from the
-- global profile, KI-109; no cross-Tenant write: composite FKs), notification
-- triggers, the rest of Forms (Form lookup, assigned-Form listings) and the
-- dashboard aggregates (other KI-111 slices).

create or replace function private.can_access_operational_order(p_order_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $$
  select
    (select private.is_internal_user())
    and exists (
      select 1
      from public.orders as order_row
      where order_row.id = p_order_id
        and order_row.tenant_id = (select private.current_tenant_id())
        and order_row.archived_at is null
        and (
          private.current_user_has_permission('client_private.read')
          or order_row.assigned_to_profile_id = (select auth.uid())
          or exists (
            select 1
            from public.order_tasks as task_row
            where task_row.order_id = order_row.id
              and task_row.assigned_to_profile_id = (select auth.uid())
              and task_row.archived_at is null
          )
        )
    );
$$;

create or replace function private.can_access_operational_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $$
  select
    (select private.is_internal_user())
    and exists (
      select 1
      from public.order_tasks as task_row
      join public.orders as order_row
        on order_row.id = task_row.order_id
       and order_row.archived_at is null
       and order_row.tenant_id = (select private.current_tenant_id())
      where task_row.id = p_task_id
        and task_row.archived_at is null
        and (
          private.current_user_has_permission('client_private.read')
          or task_row.assigned_to_profile_id = (select auth.uid())
          or order_row.assigned_to_profile_id = (select auth.uid())
        )
    );
$$;

create or replace function private.require_order_conversation_access(p_order_id uuid)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor record; project public.orders;
begin
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform public.app_require_module_access(case when actor.role_name = 'client' then 'portal_projects' else 'projects' end);
  perform private.require_permission('projects.view');
  perform private.require_permission('tickets.view');
  select * into project from public.orders where id = p_order_id and tenant_id = (select private.current_tenant_id()) and archived_at is null;
  if project.id is null or (actor.role_name = 'client' and project.company_id is distinct from actor.company_id)
    or (actor.role_name <> 'client' and not private.can_access_operational_order(p_order_id)) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return project;
end;
$$;

create or replace function public.app_assign_order(p_order_id uuid, p_assigned_to_profile_id uuid default NULL::uuid)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  update public.orders
  set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_order_id and tenant_id = (select private.current_tenant_id()) and archived_at is null
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

create or replace function public.app_update_order(p_order_id uuid, p_patch jsonb)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
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
  where id = p_order_id and tenant_id = (select private.current_tenant_id()) and archived_at is null
  returning * into order_row;
  if order_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'order', order_row.id, 'order.updated',
    format('Updated project %s.', order_row.order_number)
  );
  return order_row;
end;
$$;

create or replace function public.app_change_order_status(p_order_id uuid, p_status text)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  order_row public.orders;
  previous_status text;
begin
  perform private.require_internal_actor();
  select project.status into previous_status
  from public.orders as project
  where project.id = p_order_id and project.tenant_id = (select private.current_tenant_id()) and project.archived_at is null
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

create or replace function public.app_archive_order(p_order_id uuid)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  order_row public.orders;
begin
  select project.*
  into order_row
  from public.orders as project
  where project.id = p_order_id
    and project.tenant_id = (select private.current_tenant_id())
  for update;

  if order_row.id is null then
    raise no_data_found;
  end if;

  if not coalesce((
    private.current_user_has_permission('client_private.read')
    or order_row.assigned_to_profile_id = actor_id
    or exists (
      select 1
      from public.order_tasks as task_row
      where task_row.order_id = order_row.id
        and task_row.assigned_to_profile_id = actor_id
        and task_row.archived_at is null
    )
  ), false) then
    raise exception 'project access is denied'
      using errcode = '42501';
  end if;

  perform private.require_permission('projects.archive');

  if order_row.archived_at is not null then
    return order_row;
  end if;

  update public.orders
  set archived_at = now()
  where id = p_order_id
  returning * into order_row;

  perform private.record_authenticated_activity(
    'order',
    order_row.id,
    'order.archived',
    format('Archived project %s.', order_row.order_number)
  );

  return order_row;
end;
$$;

create or replace function public.app_create_order(p_request_id uuid, p_company_id uuid, p_service_id uuid, p_title text, p_assigned_to_profile_id uuid default NULL::uuid, p_priority text default 'normal'::text, p_due_at timestamp with time zone default NULL::timestamp with time zone, p_started_at timestamp with time zone default NULL::timestamp with time zone, p_notes text default NULL::text)
 returns public.orders
 language plpgsql
 security definer
 set search_path to ''
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
    select project.* into order_row from public.orders as project
    where project.id = existing_id and project.tenant_id = (select private.current_tenant_id());
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

create or replace function public.app_create_task(p_request_id uuid, p_order_id uuid, p_title text, p_assigned_to_profile_id uuid default NULL::uuid, p_description text default NULL::text, p_due_at timestamp with time zone default NULL::timestamp with time zone, p_sort_position integer default 0)
 returns public.order_tasks
 language plpgsql
 security definer
 set search_path to ''
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
    select task.* into task_row from public.order_tasks as task
    join public.orders as project on project.id = task.order_id and project.tenant_id = (select private.current_tenant_id())
    where task.id = existing_id;
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
$$;

create or replace function public.app_assign_task(p_task_id uuid, p_assigned_to_profile_id uuid default NULL::uuid)
 returns public.order_tasks
 language plpgsql
 security definer
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_update_task(p_task_id uuid, p_patch jsonb)
 returns public.order_tasks
 language plpgsql
 security definer
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
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
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_change_task_status(p_task_id uuid, p_status text)
 returns public.order_tasks
 language plpgsql
 security definer
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_get_my_client_project(p_project_id uuid)
 returns TABLE(id uuid, order_number bigint, title text, status text, created_at timestamp with time zone, due_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, service_name text, task_total integer, task_open integer)
 language plpgsql
 stable security definer
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
    and project.archived_at is null;
end;
$$;

create or replace function public.app_list_my_client_projects(p_limit integer default 2000)
 returns TABLE(id uuid, order_number bigint, title text, status text, created_at timestamp with time zone, due_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, service_name text, task_total integer, task_open integer)
 language plpgsql
 stable security definer
 set search_path to ''
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
    and project.tenant_id = (select private.current_tenant_id())
    and project.archived_at is null
  order by project.created_at desc, project.id
  limit safe_limit;
end;
$$;

create or replace function public.app_assign_form(p_request_id uuid, p_form_id uuid, p_context jsonb)
 returns form_assignments
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_form_capability('forms.assign');
  existing_id uuid;
  form_row public.forms;
  assignment_row public.form_assignments;
  order_row public.orders;
  client_row public.profiles;
  company_id_value uuid;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'context', p_context);
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object'
    or p_context - array['order_id', 'client_profile_id', 'required', 'due_at'] <> '{}'::jsonb
  then
    raise exception 'invalid Form assignment context' using errcode = '22023';
  end if;
  existing_id := private.find_create_request(actor_id, 'form.assign', p_request_id, request_payload);
  if existing_id is not null then
    select * into assignment_row from public.form_assignments where id = existing_id;
    if assignment_row.id is null then raise no_data_found; end if;
    return assignment_row;
  end if;

  select * into form_row
  from public.forms
  where id = p_form_id and status = 'published' and archived_at is null
  for update;
  if form_row.id is null then raise no_data_found; end if;

  if form_row.form_type = 'intake' then
    if not p_context ? 'order_id' or p_context ? 'client_profile_id' then
      raise exception 'Intake assignment requires an Order' using errcode = '22023';
    end if;
    select * into order_row from public.orders
    where id = (p_context ->> 'order_id')::uuid and tenant_id = (select private.current_tenant_id()) and archived_at is null
    for update;
    if order_row.id is null then raise no_data_found; end if;
    if not exists (
      select 1 from public.form_service_links as link
      where link.form_version_id = form_row.published_version_id
        and link.form_version_field_id is null
        and link.service_id = order_row.service_id
        and link.role = 'intake_assignment'
    ) then
      raise exception 'Intake Form is not linked to the Order Service' using errcode = '23514';
    end if;
    company_id_value := order_row.company_id;
  elsif form_row.form_type = 'onboarding' then
    if not p_context ? 'client_profile_id' or p_context ? 'order_id' then
      raise exception 'Onboarding assignment requires a client profile' using errcode = '22023';
    end if;
    select profile.* into client_row
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id and role.name = 'client'
    join public.companies as company on company.id = profile.company_id and company.archived_at is null
    where profile.id = (p_context ->> 'client_profile_id')::uuid
      and profile.archived_at is null;
    if client_row.id is null or client_row.company_id is null then raise no_data_found; end if;
    company_id_value := client_row.company_id;
  else
    raise exception 'only Intake and Onboarding Forms can be assigned' using errcode = '55000';
  end if;

  insert into public.form_assignments (
    form_id, form_version_id, company_id, client_profile_id, order_id,
    required, due_at, assigned_by_profile_id
  ) values (
    form_row.id, form_row.published_version_id, company_id_value,
    client_row.id, order_row.id,
    coalesce((p_context ->> 'required')::boolean, true),
    (p_context ->> 'due_at')::timestamptz,
    actor_id
  ) returning * into assignment_row;

  perform private.record_authenticated_activity(
    'form_assignment', assignment_row.id, 'form.assigned',
    format('Assigned %s Form.', initcap(form_row.form_type)),
    jsonb_build_object('form_id', form_row.id, 'form_version_id', form_row.published_version_id, 'company_id', company_id_value, 'order_id', order_row.id, 'client_profile_id', client_row.id)
  );
  perform private.remember_create_request(actor_id, 'form.assign', p_request_id, request_payload, assignment_row.id);
  return assignment_row;
end;
$$;
