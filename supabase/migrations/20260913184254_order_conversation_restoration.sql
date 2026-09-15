-- Order communication reuses the unique fulfillment Ticket and its message RPCs.
-- No rows are created by the read path. Both security domains must authorize.
create or replace function private.require_order_conversation_access(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = ''
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
  select * into project from public.orders where id = p_order_id and archived_at is null;
  if project.id is null or (actor.role_name = 'client' and project.company_id is distinct from actor.company_id)
    or (actor.role_name <> 'client' and not private.can_access_operational_order(p_order_id)) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return project;
end;
$$;

create or replace function public.app_get_order_conversation(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare project public.orders; linked public.tickets;
begin
  project := private.require_order_conversation_access(p_order_id);
  select * into linked from public.tickets where order_id = project.id;
  if linked.id is null then return null; end if;
  if linked.company_id is distinct from project.company_id then
    raise exception 'Ticket company does not match Project' using errcode = '42501';
  end if;
  return public.app_get_ticket_detail_with_avatars(linked.id);
end;
$$;

create or replace function public.app_send_order_message(
  p_order_id uuid, p_request_id uuid, p_body text, p_internal_note boolean default false
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  project public.orders; actor record; linked public.tickets;
  previous_id uuid; payload jsonb;
begin
  if p_request_id is null or p_internal_note is null or nullif(btrim(p_body), '') is null
    or char_length(p_body) > 50000 or octet_length(p_body) > 200000 then
    raise exception 'invalid Order message input' using errcode = '22023';
  end if;
  project := private.require_order_conversation_access(p_order_id);
  select * into actor from private.current_ticket_actor();
  if p_internal_note and actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission(case when p_internal_note then 'tickets.internal_notes' else 'tickets.reply' end);

  -- Lock the parent before discovering the child: concurrent first messages
  -- reuse the winner's Ticket. The existing unique FK index is the backstop.
  perform 1 from public.orders where id = project.id for update;
  project := private.require_order_conversation_access(p_order_id);
  select * into linked from public.tickets where order_id = project.id for update;
  if linked.id is not null then
    perform private.require_ticket_access(linked.id);
    if linked.company_id is distinct from project.company_id then
      raise exception 'Ticket company does not match Project' using errcode = '42501';
    end if;
    if linked.archived_at is not null or (not p_internal_note and linked.status = 'closed') then
      raise exception 'Ticket is not open for replies' using errcode = '55000';
    end if;
  end if;
  payload := jsonb_build_object('order_id', p_order_id, 'body', p_body, 'internal_note', p_internal_note);
  previous_id := private.find_create_request(actor.profile_id, 'order.message', p_request_id, payload);
  if previous_id is not null then return previous_id; end if;

  if linked.id is null then
    perform private.require_permission('tickets.create');
    perform private.consume_rate_limit(
      case when actor.role_name = 'client' then 'ticket.create.client.hour' else 'ticket.create.internal.hour' end,
      actor.profile_id::text, interval '1 hour', case when actor.role_name = 'client' then 10 else 60 end);
    perform private.consume_rate_limit(
      case when actor.role_name = 'client' then 'ticket.create.client.day' else 'ticket.create.internal.day' end,
      actor.profile_id::text, interval '1 day', case when actor.role_name = 'client' then 30 else 300 end);
    insert into public.tickets (order_id, company_id, client_profile_id, subject, created_by_profile_id)
    values (project.id, project.company_id, case when actor.role_name = 'client' then actor.profile_id end,
      left(project.title, 500), actor.profile_id) returning * into linked;
    perform private.record_ticket_activity(linked.id, 'ticket.created', 'Created Order conversation.',
      jsonb_build_object('order_id', project.id), actor.profile_id);
  end if;
  -- Reuse the canonical validation, rate limits, audit and visibility rules.
  if p_internal_note then
    perform public.app_add_ticket_internal_note(p_request_id, linked.id, p_body);
  else
    perform public.app_reply_to_ticket(p_request_id, linked.id, p_body);
  end if;
  perform private.remember_create_request(actor.profile_id, 'order.message', p_request_id, payload, linked.id);
  return linked.id;
end;
$$;

revoke all on function private.require_order_conversation_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_get_order_conversation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_send_order_message(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_get_order_conversation(uuid) to authenticated;
grant execute on function public.app_send_order_message(uuid, uuid, text, boolean) to authenticated;
