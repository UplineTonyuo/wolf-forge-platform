-- WL-2.5 (KI-111, Tickets): Ticket authorization is bound to the current Tenant.
--
-- Concrete attack closed: private.can_access_ticket granted any internal
-- member of the caller's current Tenant (with tickets.view) every Ticket by id,
-- whatever the Ticket's Tenant. Everything that routes through it inherited the
-- gap: private.require_ticket_access, the tickets / ticket_messages /
-- ticket_attachments SELECT policies, app_list_ticket_summaries,
-- app_get_ticket_detail(_with_avatars), replies, internal notes, unsend,
-- reactions, attachment preparation and download, forward-to-Team and client
-- presence. app_add_ticket_to_inbox, app_archive_ticket, app_assign_ticket,
-- app_update_ticket_priority and app_update_ticket_status bypassed the helper
-- and looked the Ticket up by id alone, so a Tenant B admin could archive,
-- assign or re-status a Wolf Forge Ticket (and the reverse).
--
-- Pattern (D-272, no new helper): the shared helper and every id-only lookup
-- add tickets.tenant_id = private.current_tenant_id(). By Ticket id, a foreign
-- Ticket is indistinguishable from a missing one (the same 42501 'Ticket
-- access is denied' or no_data_found); message- and attachment-id paths keep
-- their existing P0002 (missing) / 42501 (not accessible) split, which reveals
-- that the id exists (and coarse state such as message kind or scan status),
-- never its content. Children (messages, attachments, reactions)
-- inherit through ticket_id and the helper; no tenant_id is added to them.
-- Assignee eligibility stays with WL-2.4.
--
-- app_create_ticket: the Company and investment Service must belong to the
-- current Tenant (previously only the composite foreign keys caught a foreign
-- id, with a raw 23503), and the named client is checked against the current
-- Tenant's membership instead of the global profile (narrow KI-115 fix for
-- this path; identical for Wolf Forge through the WL-1A mirror). A replayed
-- request id returns the Ticket only in its own Tenant.
--
-- app_forward_ticket_message_to_team: Team conversations have no Tenant yet,
-- so a Ticket of another Tenant could be copied into a Wolf Forge Team
-- conversation by a member of both Tenants. Only Wolf Forge Ticket messages
-- may be forwarded until Team Chat is Tenant-isolated.
--
-- Not changed: Order conversation functions that reach Tickets through
-- order_id (Orders slice), Ticket notification triggers.

create or replace function private.can_access_ticket(p_ticket_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $$
  select exists (
    select 1
    from public.tickets as ticket_row
    cross join private.current_ticket_actor() as actor
    where ticket_row.id = p_ticket_id
      and ticket_row.tenant_id = (select private.current_tenant_id())
      and (
        (actor.role_name in ('owner', 'admin', 'manager', 'staff')
          and private.current_user_has_permission('tickets.view'))
        or (actor.role_name = 'client'
          and private.current_user_has_permission('tickets.view')
          and ticket_row.company_id = actor.company_id)
      )
  );
$$;

create or replace function public.app_add_ticket_to_inbox(p_ticket_id uuid)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); ticket_row public.tickets;
begin
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
$$;

create or replace function public.app_archive_ticket(p_ticket_id uuid)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); ticket_row public.tickets;
begin
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
$$;

create or replace function public.app_update_ticket_priority(p_ticket_id uuid, p_priority text)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); old_priority text; ticket_row public.tickets;
begin
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
$$;

create or replace function public.app_update_ticket_status(p_ticket_id uuid, p_status text)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); old_status text; ticket_row public.tickets;
begin
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
$$;

create or replace function public.app_create_ticket(p_request_id uuid, p_payload jsonb)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor record;
  ticket_row public.tickets;
  initial_message public.ticket_messages;
  company_id_value uuid;
  client_profile_id_value uuid;
  priority_value text := coalesce(p_payload ->> 'priority', 'normal');
  investment_service_id_value uuid;
  existing_id uuid;
begin
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['company_id', 'client_profile_id', 'subject', 'message', 'priority',
      'investment_service_id'] <> '{}'::jsonb
    or nullif(btrim(p_payload ->> 'subject'), '') is null
    or nullif(btrim(p_payload ->> 'message'), '') is null
    or char_length(p_payload ->> 'subject') > 500
    or char_length(p_payload ->> 'message') > 50000
    or priority_value not in ('low', 'normal', 'high', 'urgent')
  then raise exception 'invalid Ticket creation input' using errcode = '22023'; end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then raise exception 'verified authentication is required' using errcode = '42501'; end if;
  perform private.require_permission('tickets.create');

  existing_id := private.find_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload);
  if existing_id is not null then
    -- A replay only returns a Ticket of the current Tenant.
    select * into ticket_row from public.tickets
    where id = existing_id and tenant_id = (select private.current_tenant_id());
    if not found then raise no_data_found; end if;
    return ticket_row;
  end if;

  -- M-04. A client opening conversations is the cheapest way to manufacture
  -- staff work; internal accounts open Tickets on behalf of clients and get a
  -- correspondingly higher allowance.
  if actor.role_name = 'client' then
    perform private.consume_rate_limit(
      'ticket.create.client.hour', actor.profile_id::text, interval '1 hour', 10
    );
    perform private.consume_rate_limit(
      'ticket.create.client.day', actor.profile_id::text, interval '1 day', 30
    );
  else
    perform private.consume_rate_limit(
      'ticket.create.internal.hour', actor.profile_id::text, interval '1 hour', 60
    );
    perform private.consume_rate_limit(
      'ticket.create.internal.day', actor.profile_id::text, interval '1 day', 300
    );
  end if;

  if actor.role_name = 'client' then
    company_id_value := actor.company_id;
    client_profile_id_value := actor.profile_id;
    if company_id_value is null then raise exception 'client company is required' using errcode = '42501'; end if;
    if priority_value <> 'normal' then
      raise exception 'client cannot set Ticket priority' using errcode = '42501';
    end if;
    if p_payload ? 'company_id' and (p_payload ->> 'company_id')::uuid is distinct from company_id_value then
      raise exception 'Ticket company context cannot be spoofed' using errcode = '42501';
    end if;
    if p_payload ? 'client_profile_id' and (p_payload ->> 'client_profile_id')::uuid is distinct from client_profile_id_value then
      raise exception 'Ticket client context cannot be spoofed' using errcode = '42501';
    end if;
  else
    company_id_value := (p_payload ->> 'company_id')::uuid;
    client_profile_id_value := (p_payload ->> 'client_profile_id')::uuid;
    if company_id_value is null or not exists (
      select 1 from public.companies where id = company_id_value and tenant_id = (select private.current_tenant_id()) and archived_at is null
    ) then raise exception 'active Ticket company is required' using errcode = '23503'; end if;
    if client_profile_id_value is not null and not exists (
      select 1 from public.tenant_memberships as membership_row
      join public.roles as role_row on role_row.id = membership_row.role_id
      where membership_row.tenant_id = (select private.current_tenant_id())
        and membership_row.profile_id = client_profile_id_value
        and membership_row.company_id = company_id_value
        and membership_row.archived_at is null and role_row.name = 'client'
    ) then raise exception 'Ticket client must belong to the selected company' using errcode = '23514'; end if;
  end if;

  -- An investment conversation is a normal explicit Ticket that additionally
  -- names the service the client showed interest in. It is never linked to an
  -- Order: order_id stays null on every row this branch can produce, because
  -- nothing in this function ever writes that column.
  if nullif(p_payload ->> 'investment_service_id', '') is not null then
    investment_service_id_value := (p_payload ->> 'investment_service_id')::uuid;
    if not exists (
      select 1 from public.services where id = investment_service_id_value and tenant_id = (select private.current_tenant_id())
    ) then
      raise exception 'investment conversation service does not exist' using errcode = '23503';
    end if;
  end if;

  insert into public.tickets (
    company_id, client_profile_id, subject, status, priority, created_by_profile_id,
    investment_service_id
  ) values (
    company_id_value, client_profile_id_value, btrim(p_payload ->> 'subject'),
    'open', priority_value, actor.profile_id,
    investment_service_id_value
  ) returning * into ticket_row;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    ticket_row.id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(p_payload ->> 'message'), p_request_id
  ) returning * into initial_message;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket.',
    jsonb_build_object('company_id', company_id_value, 'initial_message_id', initial_message.id),
    actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload, ticket_row.id);
  return ticket_row;
end;
$$;

create or replace function public.app_assign_ticket(p_ticket_id uuid, p_assigned_to_profile_id uuid default null::uuid)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); old_assignee uuid; ticket_row public.tickets;
begin
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
$$;

create or replace function public.app_forward_ticket_message_to_team(p_request_id uuid, p_source_ticket_message_id uuid, p_destination_conversation_id uuid, p_comment text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor record;
  destination_actor_id uuid;
  source_message record;
  clean_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  source_author_name text;
  source_label text;
  source_excerpt text;
  available_source_length integer;
  sent record;
begin
  if p_request_id is null or p_source_ticket_message_id is null
     or p_destination_conversation_id is null
     or char_length(coalesce(p_comment, '')) > 1000 then
    raise exception 'invalid Ticket forward input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;

  select
    message.ticket_id,
    message.body,
    message.visibility,
    message.message_kind,
    message.author_type,
    ticket.order_id,
    ticket.tenant_id,
    ticket.public_ref,
    ticket.requester_name,
    project.order_number,
    author.display_name as author_name
  into source_message
  from public.ticket_messages as message
  join public.tickets as ticket on ticket.id = message.ticket_id
  left join public.orders as project on project.id = ticket.order_id
  left join public.profiles as author on author.id = message.author_profile_id
  where message.id = p_source_ticket_message_id;

  if source_message is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  perform private.require_ticket_access(source_message.ticket_id);
  -- ponytail: Team conversations have no Tenant yet, so only Wolf Forge Ticket
  -- content may be forwarded into them; scope by the destination's Tenant
  -- when Team Chat is Tenant-isolated.
  if source_message.tenant_id <> private.wolf_forge_tenant_id() then
    raise exception 'message is unavailable' using errcode = '42501';
  end if;
  if source_message.order_id is not null then
    perform private.require_order_conversation_access(source_message.order_id);
  end if;
  if source_message.visibility <> 'client' or source_message.message_kind = 'internal_note' then
    raise exception 'message is unavailable' using errcode = '42501';
  end if;

  destination_actor_id := private.require_team_conversation_member(p_destination_conversation_id);
  if destination_actor_id <> actor.profile_id then
    raise exception 'actor mismatch' using errcode = '42501';
  end if;

  source_author_name := left(coalesce(
    nullif(btrim(source_message.author_name), ''),
    case when source_message.author_type in ('client', 'guest')
      then nullif(btrim(source_message.requester_name), '') end,
    case when source_message.author_type = 'system' then 'Wolf Forge' end,
    'Client'
  ), 200);
  source_label := case when source_message.order_number is not null
    then 'Project #' || source_message.order_number::text
    else 'Ticket ' || source_message.public_ref
  end;
  available_source_length := 4000 - char_length(source_label) - 2
    - case when clean_comment is null then 0 else char_length(clean_comment) + 2 end;
  -- ponytail: Team messages cap at 4,000 characters; keep a bounded snapshot
  -- here and use the persisted source id if a future authorized detail flow needs more.
  source_excerpt := left(source_message.body, available_source_length);
  if char_length(source_message.body) > available_source_length then
    source_excerpt := left(source_excerpt, available_source_length - 3) || '...';
  end if;

  select message.id, message.request_id, message.conversation_id,
    message.author_profile_id, message.body, message.created_at,
    message.forwarded_from_ticket_message_id
  into sent
  from public.team_messages as message
  where message.request_id = p_request_id;
  if sent is not null then
    if sent.author_profile_id <> actor.profile_id
       or sent.conversation_id <> p_destination_conversation_id
       or sent.forwarded_from_ticket_message_id <> p_source_ticket_message_id
       or sent.body <> concat_ws(E'\n\n', clean_comment, source_label || E'\n' || source_excerpt) then
      raise exception 'request id already used' using errcode = '23505';
    end if;
    return private.team_message_json(sent.id, actor.profile_id);
  end if;

  perform private.enforce_team_slow_mode(p_destination_conversation_id, actor.profile_id);
  perform private.consume_rate_limit(
    'team.message.actor.minute', actor.profile_id::text, interval '1 minute', 30
  );
  perform private.consume_rate_limit(
    'team.message.actor.hour', actor.profile_id::text, interval '1 hour', 200
  );

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body,
    forwarded_from_ticket_message_id, forwarded_from_author_name
  ) values (
    p_request_id, p_destination_conversation_id, actor.profile_id,
    concat_ws(E'\n\n', clean_comment, source_label || E'\n' || source_excerpt),
    p_source_ticket_message_id, source_author_name
  )
  returning id, request_id, conversation_id, author_profile_id, body, created_at,
    forwarded_from_ticket_message_id
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_destination_conversation_id;
  perform private.record_team_message_delivery(
    sent.id, p_destination_conversation_id, actor.profile_id, sent.created_at
  );
  return private.team_message_json(sent.id, actor.profile_id);
end;
$$;
