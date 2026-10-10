-- WL-2.36: Projects published enforcement. No publication or draft rows are seeded.

CREATE OR REPLACE FUNCTION private.published_module_set_valid(p_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Reporting, Investment Intent and Projects have audited disablement coverage.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects') and not (catalog.module_key = any(p_keys))
    ), false);
$function$;

CREATE OR REPLACE FUNCTION private.profile_has_permission_in_tenant(p_profile_id uuid, p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      when p_permission_key in ('investment_intent.view', 'investment_intent.manage')
      then private.tenant_module_allowed(p_tenant_id, 'investment_intent')
      when p_permission_key in ('projects.view', 'projects.create', 'projects.edit', 'projects.assign', 'projects.archive')
      then private.tenant_module_allowed(p_tenant_id, 'projects')
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
$function$;

CREATE OR REPLACE FUNCTION private.validate_tenant_module_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
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
  if not ('projects' = any(new.module_keys)) and exists (
    select 1 from public.orders as project
    where project.tenant_id = new.tenant_id and project.archived_at is null
      and project.status not in ('complete', 'canceled')
  ) then
    raise exception 'unfinished Projects prevent disablement' using errcode = '55000';
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
$function$;

CREATE OR REPLACE FUNCTION private.publish_tenant_modules(p_tenant_id uuid, p_expected_revision integer, p_module_keys text[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  tenant_status text;
  last_revision integer;
begin
  perform private.require_platform_admin();
  actor_id := auth.uid();
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
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
  if not private.published_module_set_valid(p_module_keys) then
    raise exception 'invalid or unsupported published module set' using errcode = '22023';
  end if;
  if not ('projects' = any(p_module_keys)) and exists (
    select 1 from public.orders as project
    where project.tenant_id = p_tenant_id and project.archived_at is null
      and project.status not in ('complete', 'canceled')
  ) then
    raise exception 'unfinished Projects prevent disablement' using errcode = '55000';
  end if;
  insert into private.tenant_module_publications
    (tenant_id, revision, module_keys, published_by, reason)
  values (p_tenant_id, last_revision + 1, p_module_keys, actor_id, p_reason);
  return last_revision + 1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.can_access_operational_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (select private.is_internal_user())
    and private.tenant_module_allowed(private.current_tenant_id(), 'projects')
    and private.current_user_has_permission('projects.view')
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
$function$;

CREATE OR REPLACE FUNCTION private.can_access_operational_task(p_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (select private.is_internal_user())
    and private.tenant_module_allowed(private.current_tenant_id(), 'projects')
    and private.current_user_has_permission('projects.view')
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
$function$;

CREATE OR REPLACE FUNCTION private.enforce_order_permission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  context_payment_id uuid;
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.archived_at is null
      and new.status not in ('complete', 'canceled')) then
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = new.tenant_id for update;
  if ((select auth.uid()) is not null or exists (
      select 1 from private.tenant_module_publications where tenant_id = new.tenant_id
    )) and not private.tenant_module_allowed(new.tenant_id, 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;
  end if;
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    begin
      context_payment_id := nullif(
        current_setting('app.wf_store_purchase_payment_id', true), ''
      )::uuid;
    exception when invalid_text_representation then
      context_payment_id := null;
    end;

    if context_payment_id is not null
      and new.assigned_to_profile_id is null
      and new.status = 'pending'
      and new.archived_at is null
      and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row
          on invoice_row.id = payment_row.invoice_id
        join public.invoice_items as item_row
          on item_row.invoice_id = invoice_row.id
         and item_row.service_id = new.service_id
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and (select private.current_user_company_id()) = invoice_row.company_id
          and invoice_row.billing_reason = 'store_purchase'
          and invoice_row.status = 'paid'
          and invoice_row.company_id = new.company_id
      )
    then
      return new;
    end if;

    perform private.require_permission('projects.create');

    if new.assigned_to_profile_id is distinct from (select auth.uid())
      and new.assigned_to_profile_id is not null
    then
      perform private.require_permission('projects.assign');
    end if;

    return new;
  end if;

  if not private.can_access_operational_order(old.id) then
    raise exception 'project access is denied'
      using errcode = '42501';
  end if;

  if new.assigned_to_profile_id is distinct from old.assigned_to_profile_id then
    perform private.require_permission('projects.assign');
  end if;

  if new.archived_at is not null and old.archived_at is null then
    perform private.require_permission('projects.archive');
  else
    perform private.require_permission('projects.edit');
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_create_order(p_request_id uuid, p_company_id uuid, p_service_id uuid, p_title text, p_assigned_to_profile_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'normal'::text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.app_update_order(p_order_id uuid, p_patch jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_assign_order(p_order_id uuid, p_assigned_to_profile_id uuid DEFAULT NULL::uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare order_row public.orders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_archive_order(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_internal_actor();
  order_row public.orders;
begin
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_change_order_status(p_order_id uuid, p_status text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  order_row public.orders;
  previous_status text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_create_task(p_request_id uuid, p_order_id uuid, p_title text, p_assigned_to_profile_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_sort_position integer DEFAULT 0)
 RETURNS order_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.app_update_task(p_task_id uuid, p_patch jsonb)
 RETURNS order_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_assign_task(p_task_id uuid, p_assigned_to_profile_id uuid DEFAULT NULL::uuid)
 RETURNS order_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_reorder_task(p_task_id uuid, p_sort_position integer)
 RETURNS order_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare task_row public.order_tasks;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_change_task_status(p_task_id uuid, p_status text)
 RETURNS order_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  task_row public.order_tasks;
  previous_status text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
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
$function$;

CREATE OR REPLACE FUNCTION public.app_purchase_service_with_balance(p_request_id uuid, p_service_id uuid, p_coupon_code text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, order_number bigint, ticket_id uuid, ticket_public_ref text, invoice_id uuid, invoice_number bigint, payment_id uuid, amount_cents bigint, currency text, wallet_balance_cents bigint, service_name text, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb;
  existing_id uuid;
  service_row public.services;
  wallet_row public.company_wallets;
  invoice_row public.invoices;
  invoice_item_id uuid;
  payment_row public.invoice_payments;
  order_row public.orders;
  company_name text;
  price_cents bigint;
  coupon_application record;
  coupon_discount_cents bigint := 0;
  coupon_redemption_id uuid;
  final_price_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_service_id is null then
    raise exception 'WF_PURCHASE_INVALID_REQUEST' using errcode = '22023';
  end if;

  actor_company_id := (select private.current_user_company_id());

  if actor_company_id is null then
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  request_payload := jsonb_build_object(
    'service_id', p_service_id,
    'coupon_code', nullif(btrim(p_coupon_code), '')
  );

  existing_id := private.find_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload
  );

  if existing_id is not null then
    select * into order_row
    from public.orders
    where id = existing_id
      and company_id = actor_company_id;
    if order_row.id is null then raise no_data_found; end if;

    select item.invoice_id into invoice_id
    from public.invoice_items as item
    where item.order_id = order_row.id
    limit 1;

    select * into invoice_row from public.invoices where id = invoice_id;

    select * into payment_row
    from public.invoice_payments as payment
    where payment.invoice_id = invoice_row.id
      and payment.status = 'succeeded'
    order by payment.created_at
    limit 1;

    select * into wallet_row
    from public.company_wallets as wallet
    where wallet.company_id = actor_company_id;

    select service.name into service_name
    from public.services as service
    where service.id = order_row.service_id;

    return query
    select
      order_row.id,
      order_row.order_number,
      null::uuid,
      null::text,
      invoice_row.id,
      invoice_row.invoice_number,
      payment_row.id,
      payment_row.amount_cents,
      invoice_row.currency,
      wallet_row.balance_cents,
      service_name,
      true;
    return;
  end if;

  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = private.current_tenant_id() for update;
  if not private.tenant_module_allowed(private.current_tenant_id(), 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;
  perform private.consume_rate_limit(
    'store.purchase.client.hour', actor_id::text, interval '1 hour', 10
  );
  perform private.consume_rate_limit(
    'store.purchase.client.day', actor_id::text, interval '1 day', 40
  );

  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.tenant_id = (select private.current_tenant_id())
    and service.archived_at is null
    and service.is_active
    and service.is_public;

  if service_row.id is null then
    raise exception 'WF_PURCHASE_SERVICE_UNAVAILABLE' using errcode = '42501';
  end if;

  if service_row.recurring then
    raise exception 'WF_PURCHASE_RECURRING_UNSUPPORTED' using errcode = 'P0001';
  end if;

  price_cents := round(service_row.price * 100)::bigint;

  if price_cents is null or price_cents <= 0 then
    raise exception 'WF_PURCHASE_SERVICE_NOT_PRICED' using errcode = 'P0001';
  end if;

  -- Coupon: re-resolved here, never trusted from the browser. A coupon that is
  -- invalid at purchase time fails the whole purchase - it is never silently
  -- dropped in favour of the full price.
  if nullif(btrim(p_coupon_code), '') is not null then
    select * into coupon_application
    from private.resolve_coupon_application(
      p_coupon_code,
      jsonb_build_array(jsonb_build_object(
        'service_id', service_row.id,
        'quantity', 1,
        'unit_amount', service_row.price,
        'billing_context', 'one_time'
      )),
      service_row.price,
      actor_id,
      actor_company_id,
      price_cents
    );

    if not coupon_application.valid then
      if coupon_application.failure_code = 'ALREADY_REDEEMED' then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    coupon_discount_cents := coupon_application.discount_cents;
  end if;

  final_price_cents := price_cents - coupon_discount_cents;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> service_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < final_price_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  -- Redemption is written only now, after the balance check, inside the same
  -- transaction as the purchase: a failed purchase rolls it back, and a replay
  -- returns above without reaching here.
  if coupon_discount_cents > 0 then
    begin
      insert into public.coupon_redemptions (
        coupon_id, customer_profile_id, company_id, request_id, currency,
        original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
      ) values (
        coupon_application.coupon_id, actor_id, actor_company_id, p_request_id,
        service_row.currency,
        coupon_application.original_cart_subtotal,
        coupon_application.eligible_subtotal,
        coupon_application.discount_amount,
        coupon_application.resulting_cart_subtotal
      ) returning id into coupon_redemption_id;
    exception
      when unique_violation then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
    end;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = actor_company_id;

  insert into public.invoices (
    company_id, client_profile_id, status, currency,
    billing_reason, due_at,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
    created_by_profile_id, updated_by_profile_id
  ) values (
    actor_company_id, actor_id, 'draft', service_row.currency,
    'store_purchase', now(),
    price_cents, coupon_discount_cents, 0, final_price_cents,
    actor_id, actor_id
  ) returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id, service_id, order_id, position, name, description,
    quantity, unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
  ) values (
    invoice_row.id, service_row.id, null, 0, service_row.name, null,
    1, price_cents, coupon_discount_cents, false, 'awaiting_payment'
  ) returning id into invoice_item_id;

  perform set_config('app.wf_store_purchase_order', 'on', true);

  update public.invoices
  set status = 'unpaid',
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    invoice_row.id,
    final_price_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  select * into invoice_row from public.invoices where id = invoice_row.id;

  if invoice_row.status <> 'paid' then
    raise exception 'WF_PURCHASE_NOT_SETTLED' using errcode = 'P0001';
  end if;

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - final_price_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents, balance_after_cents,
    currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -final_price_cents, wallet_row.balance_cents,
    wallet_row.currency, 'invoice_payment',
    left('Store purchase - ' || service_row.name, 240),
    invoice_row.id, payment_row.id
  );

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  perform set_config('app.wf_store_purchase_payment_id', payment_row.id::text, true);

  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title, status, priority, notes
  ) values (
    actor_company_id,
    service_row.id,
    null,
    left(service_row.name, 500),
    'pending',
    'normal',
    null
  ) returning * into order_row;

  perform set_config('app.wf_store_purchase_payment_id', '', true);
  perform set_config('app.wf_store_purchase_order', '', true);

  update public.invoice_items
  set order_id = order_row.id,
      fulfillment_status = 'provisioned'
  where id = invoice_item_id;

  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id
  ) values (
    order_row.id,
    null,
    'system',
    'New service purchase received.' || chr(10) || chr(10)
      || 'Client: ' || coalesce(nullif(company_name, ''), 'Unknown company') || chr(10)
      || 'Service: ' || service_row.name || chr(10)
      || 'Amount: ' || invoice_row.currency || ' '
        || to_char(final_price_cents::numeric / 100, 'FM999999999999990.00') || chr(10)
      || 'Payment method: Wolf Forge Balance' || chr(10)
      || 'Invoice: #WF-' || lpad(invoice_row.invoice_number::text, 4, '0') || chr(10)
      || 'Project: #' || order_row.order_number::text || ' ' || order_row.title || chr(10)
      || 'Purchased: ' || to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY')
        || ' (UTC)' || chr(10) || chr(10)
      || 'The client has successfully completed payment. This Project is ready '
      || 'for the Wolf Forge team to begin fulfillment.',
    p_request_id
  );

  update public.service_interests
  set status = 'closed',
      in_cart = false,
      removed_at = coalesce(removed_at, now()),
      last_activity_at = now()
  where company_id = actor_company_id
    and service_id = service_row.id
    and status not in ('closed', 'not_interested');

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'order',
    order_row.id,
    'order.purchased',
    format(
      'Purchased %s with Wolf Forge Balance.',
      service_row.name
    ),
    jsonb_build_object(
      'company_id', actor_company_id,
      'service_id', service_row.id,
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'amount_cents', final_price_cents,
      'currency', invoice_row.currency,
      'payment_method', 'wolf_forge_wallet',
      'coupon_redemption_id', coupon_redemption_id,
      'coupon_discount_cents', coupon_discount_cents
    )
  );

  perform private.remember_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload, order_row.id
  );

  return query
  select
    order_row.id,
    order_row.order_number,
    null::uuid,
    null::text,
    invoice_row.id,
    invoice_row.invoice_number,
    payment_row.id,
    final_price_cents,
    invoice_row.currency,
    wallet_row.balance_cents,
    service_row.name,
    false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_assign_form(p_request_id uuid, p_form_id uuid, p_context jsonb)
 RETURNS form_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select assignment.* into assignment_row from public.form_assignments as assignment join public.forms as form_source on form_source.id = assignment.form_id where assignment.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if assignment_row.id is null then raise no_data_found; end if;
    return assignment_row;
  end if;

  select * into form_row
  from public.forms
  where id = p_form_id and status = 'published' and archived_at is null and tenant_id = (select private.current_tenant_id())
  for update;
  if form_row.id is null then raise no_data_found; end if;

  if form_row.form_type = 'intake' then
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = private.current_tenant_id() for update;
  if not private.tenant_module_allowed(private.current_tenant_id(), 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;

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
    where profile.id = (p_context ->> 'client_profile_id')::uuid
      and profile.archived_at is null;
    if client_row.id is null then raise no_data_found; end if;
    select membership_row.company_id into company_id_value
    from public.tenant_memberships as membership_row
    join public.roles as role on role.id = membership_row.role_id and role.name = 'client'
    join public.companies as company on company.id = membership_row.company_id and company.archived_at is null
    where membership_row.profile_id = client_row.id
      and membership_row.tenant_id = (select private.current_tenant_id())
      and membership_row.archived_at is null
      and membership_row.company_id is not null;
    if company_id_value is null then raise no_data_found; end if;
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
$function$;

CREATE OR REPLACE FUNCTION private.can_access_ticket(p_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.tickets as ticket_row
    cross join private.current_ticket_actor() as actor
    where ticket_row.id = p_ticket_id
      and ticket_row.tenant_id = (select private.current_tenant_id())
      and (ticket_row.order_id is null or (
        private.tenant_module_allowed(ticket_row.tenant_id, 'projects')
        and private.current_user_has_permission('projects.view')
        and exists (
          select 1 from public.orders as project
          where project.id = ticket_row.order_id and project.tenant_id = ticket_row.tenant_id
            and project.archived_at is null
            and ((actor.role_name = 'client' and project.company_id = actor.company_id)
              or (actor.role_name <> 'client' and private.can_access_operational_order(project.id)))
        )
      ))
      and (
        (actor.role_name in ('owner', 'admin', 'manager', 'staff')
          and private.current_user_has_permission('tickets.view'))
        or (actor.role_name = 'client'
          and private.current_user_has_permission('tickets.view')
          and ticket_row.company_id = actor.company_id)
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.require_ticket_access(p_ticket_id uuid)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ticket_row public.tickets;
begin
  select * into ticket_row from public.tickets
  where id = p_ticket_id and tenant_id = private.current_tenant_id();
  if ticket_row.order_id is not null and private.current_user_has_permission('tickets.view')
      and (private.is_internal_user() or (private.is_client_user()
        and ticket_row.company_id = private.current_user_company_id())) then
    -- Preserve the established Project not-found contract for unrelated internal staff.
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  select * into ticket_row from public.tickets where id = p_ticket_id;
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_update_ticket_status(p_ticket_id uuid, p_status text)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := (select auth.uid()); old_status text; ticket_row public.tickets;
begin
  if exists (select 1 from public.tickets where id = p_ticket_id
      and tenant_id = private.current_tenant_id() and order_id is not null)
      and not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.edit');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  select status into old_status from public.tickets where id = p_ticket_id and tenant_id = (select private.current_tenant_id()) and archived_at is null for update;
  if old_status is null then raise no_data_found; end if;
  if p_status not in ('open', 'in_progress', 'waiting_on_client', 'waiting_on_team', 'resolved', 'closed')
    or not private.ticket_status_transition_valid(old_status, p_status)
  then raise exception 'invalid Ticket status transition' using errcode = '55000'; end if;
  if old_status = p_status then select * into ticket_row from public.tickets where id = p_ticket_id; return ticket_row; end if;
  update public.tickets set
    status = p_status,
    resolved_at = case when p_status = 'resolved' then now() else null end,
    closed_at = case when p_status = 'closed' then now() else null end
  where id = p_ticket_id returning * into ticket_row;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.status_changed', format('Changed Ticket status from %s to %s.', old_status, p_status),
    jsonb_build_object('from', old_status, 'to', p_status), actor_id
  );
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_update_ticket_priority(p_ticket_id uuid, p_priority text)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := (select auth.uid()); old_priority text; ticket_row public.tickets;
begin
  if exists (select 1 from public.tickets where id = p_ticket_id
      and tenant_id = private.current_tenant_id() and order_id is not null)
      and not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.edit');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'invalid Ticket priority' using errcode = '22023'; end if;
  select priority into old_priority from public.tickets where id = p_ticket_id and tenant_id = (select private.current_tenant_id()) and archived_at is null for update;
  if old_priority is null then raise no_data_found; end if;
  update public.tickets set priority = p_priority where id = p_ticket_id returning * into ticket_row;
  if old_priority <> p_priority then
    perform private.record_ticket_activity(
      p_ticket_id, 'ticket.priority_changed', format('Changed Ticket priority from %s to %s.', old_priority, p_priority),
      jsonb_build_object('from', old_priority, 'to', p_priority), actor_id
    );
  end if;
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_archive_ticket(p_ticket_id uuid)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := (select auth.uid()); ticket_row public.tickets;
begin
  if exists (select 1 from public.tickets where id = p_ticket_id
      and tenant_id = private.current_tenant_id() and order_id is not null)
      and not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.archive');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  select * into ticket_row from public.tickets where id = p_ticket_id and tenant_id = (select private.current_tenant_id()) for update;
  if ticket_row.id is null then raise no_data_found; end if;
  if ticket_row.archived_at is null then
    update public.tickets set archived_at = now() where id = p_ticket_id returning * into ticket_row;
    perform private.record_ticket_activity(p_ticket_id, 'ticket.archived', 'Archived Ticket.', '{}'::jsonb, actor_id);
  end if;
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_assign_ticket(p_ticket_id uuid, p_assigned_to_profile_id uuid DEFAULT NULL::uuid)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := (select auth.uid()); old_assignee uuid; ticket_row public.tickets;
begin
  if exists (select 1 from public.tickets where id = p_ticket_id
      and tenant_id = private.current_tenant_id() and order_id is not null)
      and not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.assign');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  -- The assignee is validated against the Ticket's own Tenant by
  -- tickets_require_internal_assignee.
  select assigned_to_profile_id into old_assignee
  from public.tickets where id = p_ticket_id and tenant_id = (select private.current_tenant_id()) and archived_at is null for update;
  if not found then raise no_data_found; end if;
  update public.tickets set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_ticket_id returning * into ticket_row;
  if old_assignee is distinct from p_assigned_to_profile_id then
    perform private.record_ticket_activity(
      p_ticket_id, 'ticket.assigned', 'Changed Ticket assignment.',
      jsonb_build_object('from_profile_id', old_assignee, 'to_profile_id', p_assigned_to_profile_id), actor_id
    );
  end if;
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_add_ticket_to_inbox(p_ticket_id uuid)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid := (select auth.uid()); ticket_row public.tickets;
begin
  if exists (select 1 from public.tickets where id = p_ticket_id
      and tenant_id = private.current_tenant_id() and order_id is not null)
      and not private.can_access_ticket(p_ticket_id) then
    raise exception 'Ticket access is denied' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.edit');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  select * into ticket_row from public.tickets where id = p_ticket_id and tenant_id = (select private.current_tenant_id()) for update;
  if ticket_row.id is null then raise no_data_found; end if;
  if ticket_row.inbox_added_at is null then
    update public.tickets set inbox_added_at = now() where id = p_ticket_id returning * into ticket_row;
    perform private.record_ticket_activity(
      p_ticket_id, 'ticket.inbox_added',
      'Added this Ticket to the Inbox Ticket conversation list.',
      '{}'::jsonb, actor_id
    );
  end if;
  return ticket_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_list_my_notifications(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, company_id uuid, audience text, category text, variant text, title text, body text, href text, entity_type text, entity_id uuid, actor_profile_id uuid, event_key text, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select
    notification.id,
    notification.company_id,
    notification.audience,
    notification.category,
    notification.variant,
    notification.title,
    notification.body,
    notification.href,
    notification.entity_type,
    notification.entity_id,
    notification.actor_profile_id,
    notification.event_key,
    notification.read_at,
    notification.created_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id and linked_ticket.order_id is not null
        and not private.can_access_ticket(linked_ticket.id)
    ))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    )
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_mark_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = p_notification_id
    and notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id and linked_ticket.order_id is not null
        and not private.can_access_ticket(linked_ticket.id)
    ))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  changed := found;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications as notification
  set read_at = now()
  where notification.recipient_profile_id = caller_id
    and notification.read_at is null
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id and linked_ticket.order_id is not null
        and not private.can_access_ticket(linked_ticket.id)
    ))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION private.notify_project_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  project_title text := coalesce(nullif(payload ->> 'title', ''), 'New Project');
  company_name text;
begin
  -- Store purchases emit payment notifications and a Project system message.
  -- Suppress the duplicate generic Project-created notice.
  if coalesce(
       nullif(current_setting('app.wf_store_purchase_order', true), ''),
       ''
     ) = 'on'
  then
    return new;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = company_id;

  perform private.emit_internal_notification_for_permission(
    'projects.view',
    'project-created:' || new.id::text,
    'project',
    'info',
    'Project created',
    -- The audit found this body was the bare title, which is unactionable in a
    -- multi-client agency. Every other emitter names the company; now so does
    -- this one.
    case
      when company_name is null then project_title
      else company_name || ' · #' || new.order_number::text || ' ' || project_title
    end,
    '/orders/' || new.id::text,
    'order',
    new.id,
    (select auth.uid()),
    company_id,
    now()
  );

  return new;
end;
$function$;

create or replace function public.app_store_purchase_projects_enabled()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare client_actor record;
begin
  select * into client_actor from private.current_store_client();
  if client_actor.profile_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  return private.tenant_module_allowed(private.current_tenant_id(), 'projects');
end;
$$;
revoke all on function public.app_store_purchase_projects_enabled() from public, anon, authenticated, service_role;
grant execute on function public.app_store_purchase_projects_enabled() to authenticated;

create policy activity_events_published_projects on public.activity_events
as restrictive for select to authenticated
using (
  (entity_type not in ('order', 'order_task') or public.app_has_permission('projects.view'))
  and (entity_type <> 'ticket' or private.can_access_ticket(entity_id))
);

-- RLS evaluates this existing boolean guard as the caller; its Tenant/actor checks still apply.
grant execute on function private.can_access_ticket(uuid) to authenticated;