-- Managers receive Project scope; module publication, explicit denies and Tenant isolation still apply.
do $migration$
declare target oid; original text; replacement text; definition text; owner_before oid; acl_before aclitem[];
begin
  target := 'private.can_access_operational_order(uuid)'::regprocedure;
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if md5(original) <> '57a870c6fb7f4404b21c6f34a47de951' then raise exception 'Unexpected baseline for private.can_access_operational_order(uuid)'; end if;
  replacement := $body$
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
          private.current_user_role_name() = 'manager'
          or private.current_user_has_permission('client_private.read')
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
$body$;
  definition := pg_get_functiondef(target);
  if position(original in definition)=0 then raise exception 'Function source unavailable'; end if;
  execute replace(definition,original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then raise exception 'Function preservation failed'; end if;
  target := 'private.can_access_operational_task(uuid)'::regprocedure;
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if md5(original) <> '5df7245760ba9a61865fb897736b9ef2' then raise exception 'Unexpected baseline for private.can_access_operational_task(uuid)'; end if;
  replacement := $body$
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
          private.current_user_role_name() = 'manager'
          or private.current_user_has_permission('client_private.read')
          or task_row.assigned_to_profile_id = (select auth.uid())
          or order_row.assigned_to_profile_id = (select auth.uid())
        )
    );
$body$;
  definition := pg_get_functiondef(target);
  if position(original in definition)=0 then raise exception 'Function source unavailable'; end if;
  execute replace(definition,original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then raise exception 'Function preservation failed'; end if;
  target := 'public.app_archive_order(uuid)'::regprocedure;
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if md5(original) <> '871335c0d0756fbf433e7105095410bf' then raise exception 'Unexpected baseline for public.app_archive_order(uuid)'; end if;
  replacement := $body$
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
    private.current_user_role_name() = 'manager'
          or private.current_user_has_permission('client_private.read')
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

  perform private.require_permission('projects.view');
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
$body$;
  definition := pg_get_functiondef(target);
  if position(original in definition)=0 then raise exception 'Function source unavailable'; end if;
  execute replace(definition,original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then raise exception 'Function preservation failed'; end if;
end;
$migration$;

insert into public.role_permissions(role_id,permission_key,allowed)
select id,'projects.archive',true from public.roles where name='manager'
on conflict(role_id,permission_key) do nothing;
