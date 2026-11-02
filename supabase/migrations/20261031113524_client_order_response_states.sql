-- Client-only reply metadata. Internal metadata and all conversation writes stay unchanged.
create function public.app_list_my_order_response_states(p_order_ids uuid[])
returns table(order_id uuid, unanswered boolean)
language plpgsql stable security definer set search_path='' as $$
declare company_id_value uuid;
begin
  select account.company_id into company_id_value from public.app_get_client_account_context() account;
  perform public.app_require_module_access('portal_projects');
  perform private.require_permission('projects.view');
  perform private.require_permission('tickets.view');
  if p_order_ids is null or cardinality(p_order_ids)>2000
    or (cardinality(p_order_ids)>0 and array_ndims(p_order_ids)<>1)
    or exists(select 1 from unnest(p_order_ids) id where id is null)
  then raise exception 'Invalid order response request' using errcode='22023'; end if;

  return query select project.id,
    case when linked.id is not null and (
      linked.tenant_id is distinct from project.tenant_id
      or linked.company_id is distinct from project.company_id
      or not private.can_access_ticket(linked.id)
    ) then null::boolean else coalesce(latest.author_type='internal',false) end
  from public.orders project
  join (select distinct id from unnest(p_order_ids) id) requested on requested.id=project.id
  left join public.tickets linked on linked.order_id=project.id
  left join lateral (
    select human.author_type from (
      (select message.author_type,message.created_at,message.id from public.ticket_messages message
       where linked.id is not null and message.ticket_id=linked.id
         and linked.tenant_id=project.tenant_id and linked.company_id=project.company_id
         and private.can_access_ticket(linked.id)
         and message.visibility='client' and message.message_kind in ('initial_request','reply')
         and message.unsent_at is null and message.author_type in ('client','internal')
       order by message.created_at desc,message.id desc limit 1)
      union all
      (select message.author_type,message.created_at,message.id from public.project_messages message
       where linked.id is null and message.order_id=project.id and message.author_type in ('client','internal')
       order by message.created_at desc,message.id desc limit 1)
    ) human order by human.created_at desc,human.id desc limit 1
  ) latest on true
  where project.tenant_id=(select private.current_tenant_id())
    and project.company_id=company_id_value and project.archived_at is null;
end;
$$;
revoke all on function public.app_list_my_order_response_states(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.app_list_my_order_response_states(uuid[]) to authenticated;
comment on function public.app_list_my_order_response_states(uuid[]) is
  'Client-company-scoped ID and nullable reply flag only. A latest public human staff message is unanswered until a later public company-client reply; reads, private notes, system and guest events do not change direction. Legacy Ticket authority takes precedence; unavailable access remains unknown.';

-- Delegate only this reviewed read operation; retain every other operation, owner and ACL.
do $migration$
declare
  target oid := 'private.client_support_operation_allowed(text,text)'::regprocedure;
  original text;
  replacement text;
  owner_before oid;
  acl_before aclitem[];
  needle text := $entry$'app_list_my_client_projects',$entry$;
begin
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1
    or position('app_list_my_order_response_states' in original)>0
  then raise exception 'Unexpected support operation baseline'; end if;
  replacement:=replace(original,needle,$entry$'app_list_my_client_projects','app_list_my_order_response_states',$entry$);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before)
  then raise exception 'Support operation preservation failed'; end if;
end;
$migration$;
