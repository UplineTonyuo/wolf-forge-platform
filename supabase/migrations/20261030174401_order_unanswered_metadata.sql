-- Read-only Orders metadata. Source precedence matches app_get_order_conversation.
create function public.app_list_order_response_states(p_order_ids uuid[])
returns table(order_id uuid, unanswered boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
  perform private.require_permission('projects.view');
  perform private.require_permission('tickets.view');
  if p_order_ids is null or cardinality(p_order_ids) > 2000
    or (cardinality(p_order_ids) > 0 and array_ndims(p_order_ids) <> 1)
    or exists (select 1 from unnest(p_order_ids) id where id is null)
  then raise exception 'Invalid order response request' using errcode = '22023'; end if;

  return query
  select project.id,
    case when linked.id is not null and (
      linked.tenant_id is distinct from project.tenant_id
      or linked.company_id is distinct from project.company_id
      or not private.can_access_ticket(linked.id)
    ) then null::boolean
    else coalesce(latest.author_type = 'client', false) end
  from public.orders project
  join (select distinct id from unnest(p_order_ids) id) requested on requested.id = project.id
  left join public.tickets linked on linked.order_id = project.id
  left join lateral (
    select human.author_type from (
      (select message.author_type, message.created_at, message.id
      from public.ticket_messages message
      where linked.id is not null and message.ticket_id = linked.id
        and linked.tenant_id = project.tenant_id and linked.company_id = project.company_id
        and private.can_access_ticket(linked.id)
        and message.visibility = 'client' and message.message_kind in ('initial_request', 'reply')
        and message.unsent_at is null and message.author_type in ('client', 'internal')
      order by message.created_at desc, message.id desc limit 1)
      union all
      (select message.author_type, message.created_at, message.id
      from public.project_messages message
      where linked.id is null and message.order_id = project.id
        and message.author_type in ('client', 'internal')
      order by message.created_at desc, message.id desc limit 1)
    ) human
    order by human.created_at desc, human.id desc limit 1
  ) latest on true
  where project.tenant_id = (select private.current_tenant_id())
    and project.archived_at is null
    and private.can_access_operational_order(project.id);
end;
$$;

revoke all on function public.app_list_order_response_states(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.app_list_order_response_states(uuid[]) to authenticated;
comment on function public.app_list_order_response_states(uuid[]) is
  'Bounded internal-only public reply metadata. Latest public client message is unanswered until a later public internal reply. System events, notes, reads, reactions and legacy guest messages neither create nor clear the flag. NULL means linked conversation access is unavailable; never fall back to native in that case.';
