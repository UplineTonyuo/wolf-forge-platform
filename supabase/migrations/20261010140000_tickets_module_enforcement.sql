-- WL-2.37: Tickets published enforcement. No drafts or publications are seeded.

create function private.lock_tenant_module_lifecycle(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Module lifecycle requires READ COMMITTED' using errcode='55000';
  end if;
  perform 1 from public.tenants where id=p_tenant_id for update;
  if not found then raise exception 'Tenant not found' using errcode='P0002'; end if;
end;
$$;

create function private.require_tickets_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_tenant_module_lifecycle(p_tenant_id);
  -- Preserve trusted setup only before a publication exists.
  if auth.uid() is null and not exists (
    select 1 from private.tenant_module_publications where tenant_id=p_tenant_id
  ) then return; end if;
  if not private.tenant_module_allowed(p_tenant_id,'tickets') then
    raise exception 'Tickets access is denied' using errcode='42501';
  end if;
end;
$$;

create function private.enforce_ticket_module_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_tenant uuid; target_order uuid; target_company uuid; project_tenant uuid; project_company uuid;
begin
  case tg_table_name
    when 'tickets' then target_tenant:=new.tenant_id; target_order:=new.order_id; target_company:=new.company_id;
    when 'ticket_messages' then
      select tenant_id,order_id,company_id into target_tenant,target_order,target_company from public.tickets where id=new.ticket_id;
    when 'ticket_attachments' then
      select tenant_id,order_id,company_id into target_tenant,target_order,target_company from public.tickets where id=new.ticket_id;
    when 'ticket_message_reactions' then
      select t.tenant_id,t.order_id,t.company_id into target_tenant,target_order,target_company from public.ticket_messages m
      join public.tickets t on t.id=m.ticket_id where m.id=new.message_id;
    when 'project_messages' then target_order:=new.order_id;
    when 'project_attachments' then target_order:=new.order_id;
    when 'project_message_reactions' then
      select order_id into target_order from public.project_messages where id=new.message_id;
    else raise exception 'unsupported conversation table' using errcode='55000';
  end case;
  if tg_table_name = 'tickets' and target_tenant is null then
    raise exception 'null value in column "tenant_id" of relation "tickets" violates not-null constraint' using errcode='23502';
  end if;
  if target_order is not null then
    select tenant_id,company_id into project_tenant,project_company from public.orders where id=target_order;
    if project_tenant is null or (target_tenant is not null and target_tenant is distinct from project_tenant) then
      raise exception 'insert or update on table "tickets" violates foreign key constraint "tickets_order_id_fkey"' using errcode='23503';
    end if;
    if target_tenant is not null and target_company is distinct from project_company then
      raise exception 'conversation parent is unavailable' using errcode='42501';
    end if;
    target_tenant:=project_tenant;
  end if;
  if target_tenant is null then raise exception 'conversation parent not found' using errcode='23503'; end if;
  perform private.require_tickets_write(target_tenant);
  if target_order is not null and (auth.uid() is not null or exists (
    select 1 from private.tenant_module_publications where tenant_id=target_tenant
  )) and not private.tenant_module_allowed(target_tenant,'projects') then
    raise exception 'Project access is denied' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_tenant_module_lifecycle(uuid),
  private.require_tickets_write(uuid), private.enforce_ticket_module_write()
from public,anon,authenticated,service_role;

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
    and (not ('projects' = any(p_keys)) or 'tickets' = any(p_keys))
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- Four modules have audited disablement coverage.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets') and not (catalog.module_key = any(p_keys))
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
      when p_permission_key in ('tickets.view', 'tickets.create', 'tickets.reply', 'tickets.edit', 'tickets.assign', 'tickets.internal_notes', 'tickets.archive')
      then private.tenant_module_allowed(p_tenant_id, 'tickets')
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
  if not ('tickets' = any(new.module_keys)) and exists (
    select 1 from public.tickets where tenant_id=new.tenant_id
      and archived_at is null and status<>'closed'
  ) then
    raise exception 'unclosed Tickets prevent disablement' using errcode='55000';
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
  if not ('tickets' = any(p_module_keys)) and exists (
    select 1 from public.tickets where tenant_id=p_tenant_id
      and archived_at is null and status<>'closed'
  ) then
    raise exception 'unclosed Tickets prevent disablement' using errcode='55000';
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
      and private.tenant_module_allowed(ticket_row.tenant_id, 'tickets')
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

CREATE OR REPLACE FUNCTION public.app_create_ticket(p_request_id uuid, p_payload jsonb)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.require_tickets_write(private.current_tenant_id());


  existing_id := private.find_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload);
  if existing_id is not null then
    -- A replay only returns a Ticket of the current Tenant.
    select * into ticket_row from public.tickets
    where id = existing_id and tenant_id = (select private.current_tenant_id());
    if not found then raise no_data_found; end if;
    ticket_row := private.require_ticket_access(existing_id);
    return ticket_row;
  end if;

  -- New investment conversations name a Tenant-validated Service FK below.
  -- Accepted request replays remain ordinary authorized Ticket reads.
  if nullif(p_payload ->> 'investment_service_id', '') is not null then
    if not private.tenant_module_allowed(private.current_tenant_id(), 'investment_intent')
      or not private.tenant_module_allowed(private.current_tenant_id(), 'tickets') then
      raise exception 'Investment Ticket access is denied' using errcode = '42501';
    end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.app_reply_to_ticket(p_request_id uuid, p_ticket_id uuid, p_body text)
 RETURNS ticket_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; ticket_row public.tickets; message_row public.ticket_messages; existing_id uuid; payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or nullif(btrim(p_body), '') is null
    or char_length(p_body) > 50000
    or octet_length(p_body) > 200000
  then raise exception 'invalid Ticket reply input' using errcode = '22023'; end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then raise exception 'verified authentication is required' using errcode = '42501'; end if;
  perform private.require_permission('tickets.reply');
  perform private.require_tickets_write(private.current_tenant_id());

  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.archived_at is not null or ticket_row.status = 'closed' then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;
  payload := jsonb_build_object('ticket_id', p_ticket_id, 'body', p_body);
  existing_id := private.find_create_request(actor.profile_id, 'ticket.reply', p_request_id, payload);
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  -- M-04. Conversation-scoped first, so a burst against one Ticket is stopped
  -- before it consumes the actor's wider allowance. Both subjects include the
  -- server-derived profile id, so no participant shares a bucket with another.
  perform private.consume_rate_limit(
    'ticket.reply.conversation.minute',
    actor.profile_id::text || ':' || p_ticket_id::text,
    interval '1 minute',
    6
  );
  perform private.consume_rate_limit(
    'ticket.reply.conversation.day',
    actor.profile_id::text || ':' || p_ticket_id::text,
    interval '1 day',
    200
  );
  perform private.consume_rate_limit(
    'ticket.reply.actor.minute', actor.profile_id::text, interval '1 minute', 10
  );
  perform private.consume_rate_limit(
    'ticket.reply.actor.hour', actor.profile_id::text, interval '1 hour', 120
  );

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    p_ticket_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'reply', 'client', btrim(p_body), p_request_id
  ) returning * into message_row;
  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.replied', 'Replied to Ticket.',
    jsonb_build_object('message_id', message_row.id, 'author_type', message_row.author_type), actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.reply', p_request_id, payload, message_row.id);
  return message_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_add_ticket_internal_note(p_request_id uuid, p_ticket_id uuid, p_body text)
 RETURNS ticket_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; ticket_row public.tickets; message_row public.ticket_messages; existing_id uuid; payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or nullif(btrim(p_body), '') is null
    or char_length(p_body) > 50000
    or octet_length(p_body) > 200000
  then raise exception 'invalid Ticket note input' using errcode = '22023'; end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.internal_notes');
  perform private.require_tickets_write(private.current_tenant_id());

  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.archived_at is not null then raise exception 'archived Ticket cannot receive notes' using errcode = '55000'; end if;
  payload := jsonb_build_object('ticket_id', p_ticket_id, 'body', p_body);
  existing_id := private.find_create_request(actor.profile_id, 'ticket.internal_note', p_request_id, payload);
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  perform private.consume_rate_limit(
    'ticket.note.actor.minute', actor.profile_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'ticket.note.actor.day', actor.profile_id::text, interval '1 day', 500
  );

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    p_ticket_id, actor.profile_id, 'internal', 'internal_note', 'internal', btrim(p_body), p_request_id
  ) returning * into message_row;
  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.internal_note_added', 'Added an internal Ticket note.',
    jsonb_build_object('message_id', message_row.id), actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.internal_note', p_request_id, payload, message_row.id);
  return message_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_reply_to_ticket_message(p_request_id uuid, p_ticket_id uuid, p_body text, p_reply_to_message_id uuid, p_reply_to_attachment_id uuid DEFAULT NULL::uuid)
 RETURNS ticket_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor record;
  ticket_row public.tickets;
  source_row public.ticket_messages;
  message_row public.ticket_messages;
  existing_id uuid;
  clean_quote text;
  payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or p_reply_to_message_id is null
     or nullif(btrim(p_body), '') is null or char_length(p_body) > 50000
     or octet_length(p_body) > 200000 then
    raise exception 'invalid Ticket reply input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');
  perform private.require_tickets_write(private.current_tenant_id());

  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if ticket_row.archived_at is not null or ticket_row.status = 'closed' then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;

  select * into source_row
  from public.ticket_messages as message
  where message.id = p_reply_to_message_id
    and message.ticket_id = p_ticket_id
    and message.visibility = 'client'
    and message.message_kind <> 'internal_note';
  if source_row.id is null then
    raise exception 'reply source is unavailable' using errcode = '42501';
  end if;

  -- The attachment target, if any, must genuinely belong to this exact
  -- parent message — the multi-image case (source message #7 carries two
  -- images; a reply to image #2 must not silently resolve to image #1).
  if p_reply_to_attachment_id is not null and not exists (
    select 1 from public.ticket_attachments as attachment
    where attachment.id = p_reply_to_attachment_id
      and attachment.ticket_message_id = source_row.id
  ) then
    raise exception 'reply attachment target is invalid' using errcode = '22023';
  end if;

  clean_quote := left(
    regexp_replace(private.team_message_plain_text(source_row.body), '\s+', ' ', 'g'),
    500
  );
  -- U+FFFC is the blank-body placeholder written for text-less attachment
  -- sends; team_message_plain_text() leaves it untouched (it is not
  -- whitespace), so it must be stripped before the blank check below.
  if nullif(btrim(replace(clean_quote, chr(65532), '')), '') is null then
    if p_reply_to_attachment_id is not null then
      -- A specific attachment was targeted: the text fallback describes
      -- that exact attachment, not "any attachment on the message".
      select case when attachment.mime_type like 'image/%' then 'Image' else 'Attachment' end
      into clean_quote
      from public.ticket_attachments as attachment
      where attachment.id = p_reply_to_attachment_id;
    else
      select case
          when count(*) = 0 then 'Message'
          when count(*) = count(*) filter (where attachment.mime_type like 'image/%') then 'Image'
          else 'Attachment'
        end
      into clean_quote
      from public.ticket_attachments as attachment
      where attachment.ticket_message_id = source_row.id;
    end if;
  end if;
  payload := jsonb_build_object(
    'ticket_id', p_ticket_id,
    'body', p_body,
    'reply_to_message_id', p_reply_to_message_id,
    'reply_to_attachment_id', p_reply_to_attachment_id
  );
  existing_id := private.find_create_request(
    actor.profile_id, 'ticket.reply_to_message', p_request_id, payload
  );
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body,
    request_id, reply_to_message_id, reply_to_attachment_id, reply_quote_text
  ) values (
    p_ticket_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'reply', 'client', btrim(p_body), p_request_id, p_reply_to_message_id, p_reply_to_attachment_id, clean_quote
  ) returning * into message_row;

  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.replied', 'Replied to a Ticket message.',
    jsonb_build_object(
      'message_id', message_row.id,
      'reply_to_message_id', p_reply_to_message_id,
      'reply_to_attachment_id', p_reply_to_attachment_id,
      'author_type', message_row.author_type
    ), actor.profile_id
  );
  perform private.remember_create_request(
    actor.profile_id, 'ticket.reply_to_message', p_request_id, payload, message_row.id
  );
  return message_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_toggle_ticket_message_reaction(p_message_id uuid, p_reaction_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_row public.ticket_messages;
  ticket_row public.tickets;
  actor record;
  now_active boolean;
begin
  select * into source_row from public.ticket_messages where id = p_message_id;
  if source_row.id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');
  perform private.require_tickets_write(private.current_tenant_id());

  ticket_row := private.require_ticket_access(source_row.ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if actor.role_name = 'client' and source_row.visibility <> 'client' then
    raise exception 'message access is denied' using errcode = '42501';
  end if;
  if p_reaction_code is null or p_reaction_code not in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  ) then
    raise exception 'invalid reaction code' using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'ticket.reaction.actor', actor.profile_id::text, interval '1 minute', 60
  );
  insert into public.ticket_message_reactions as reaction (
    message_id, reactor_profile_id, reaction_code, active, created_at, updated_at
  ) values (
    p_message_id, actor.profile_id, p_reaction_code, true, clock_timestamp(), clock_timestamp()
  )
  on conflict (message_id, reactor_profile_id, reaction_code)
  do update set active = not reaction.active, updated_at = clock_timestamp()
  returning reaction.active into now_active;

  return jsonb_build_object(
    'message_id', p_message_id,
    'reacted_by_me', now_active,
    'reactions', private.ticket_message_reactions_json(p_message_id, actor.profile_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_unsend_ticket_internal_note(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor record;
  note public.ticket_messages;
  ticket_row public.tickets;
  unsent_time timestamptz;
begin
  if p_message_id is null then
    raise exception 'invalid Ticket note input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.internal_notes');
  perform private.require_tickets_write(private.current_tenant_id());


  select * into note
  from public.ticket_messages
  where id = p_message_id
  for update;

  if note.id is null or note.message_kind <> 'internal_note' or note.visibility <> 'internal' then
    raise exception 'Ticket note not found' using errcode = 'P0002';
  end if;

  ticket_row := private.require_ticket_access(note.ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if note.author_profile_id is distinct from actor.profile_id then
    raise exception 'only the note author may unsend it' using errcode = '42501';
  end if;

  if note.unsent_at is not null then
    return jsonb_build_object('ticket_id', note.ticket_id, 'order_id', ticket_row.order_id);
  end if;

  perform private.consume_rate_limit(
    'ticket.internal_note.unsend.actor', actor.profile_id::text, interval '1 minute', 60
  );
  unsent_time := clock_timestamp();

  update public.ticket_messages
  set body = 'This note was unsent.',
      unsent_at = unsent_time,
      unsent_by_profile_id = actor.profile_id
  where id = note.id;

  update public.tickets set updated_at = unsent_time where id = note.ticket_id;
  perform private.record_ticket_activity(
    note.ticket_id,
    'ticket.internal_note_unsent',
    'Unsent an internal Ticket note.',
    jsonb_build_object('message_id', note.id),
    actor.profile_id
  );

  return jsonb_build_object('ticket_id', note.ticket_id, 'order_id', ticket_row.order_id);
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
  perform private.require_tickets_write(private.current_tenant_id());

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
  perform private.require_tickets_write(private.current_tenant_id());

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
  perform private.require_tickets_write(private.current_tenant_id());

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
  perform private.require_tickets_write(private.current_tenant_id());

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
  perform private.require_tickets_write(private.current_tenant_id());

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

CREATE OR REPLACE FUNCTION private.prepare_ticket_attachment(p_request_id uuid, p_ticket_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_reply_to_message_id uuid DEFAULT NULL::uuid, p_consume_rate_limit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; ticket_row public.tickets; project public.orders;
begin
  if p_request_id is null or (p_ticket_id is null) = (p_order_id is null) then
    raise exception 'invalid Ticket attachment target' using errcode = '22023';
  end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');
  perform private.require_tickets_write(private.current_tenant_id());


  if p_order_id is not null then
    project := private.require_order_conversation_access(p_order_id);
    select * into ticket_row from public.tickets where order_id = project.id;
    if p_reply_to_message_id is not null and (
      (ticket_row.id is not null and not exists (
        select 1 from public.ticket_messages
        where id = p_reply_to_message_id and ticket_id = ticket_row.id
          and visibility = 'client' and message_kind <> 'internal_note'
      )) or
      (ticket_row.id is null and not exists (
        select 1 from public.project_messages
        where id = p_reply_to_message_id and order_id = project.id
      ))
    ) then
      raise exception 'reply source is unavailable' using errcode = '42501';
    end if;
  else
    ticket_row := private.require_ticket_access(p_ticket_id);
    if ticket_row.order_id is not null then
      perform private.require_order_conversation_access(ticket_row.order_id);
    end if;
    if p_reply_to_message_id is not null and not exists (
      select 1 from public.ticket_messages
      where id = p_reply_to_message_id and ticket_id = ticket_row.id
        and visibility = 'client' and message_kind <> 'internal_note'
    ) then
      raise exception 'reply source is unavailable' using errcode = '42501';
    end if;
  end if;
  if ticket_row.id is not null
     and (ticket_row.archived_at is not null or ticket_row.status = 'closed') then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;
  if p_consume_rate_limit then
    perform private.consume_rate_limit(
      'ticket.attachment.actor.hour', actor.profile_id::text, interval '1 hour', 30
    );
  end if;
  return jsonb_build_object('storage_key', actor.profile_id::text || '/' || p_request_id::text);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_forward_ticket_message_to_team(p_request_id uuid, p_source_ticket_message_id uuid, p_destination_conversation_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.require_tickets_write(private.current_tenant_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.app_send_order_message(p_order_id uuid, p_request_id uuid, p_body text, p_internal_note boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  project public.orders;
  actor record;
  linked public.tickets;
  message_row public.project_messages;
  previous_id uuid;
  payload jsonb;
begin
  if p_request_id is null or p_internal_note is null
     or nullif(btrim(p_body), '') is null or char_length(p_body) > 50000
     or octet_length(p_body) > 200000 then
    raise exception 'invalid Order message input' using errcode = '22023';
  end if;
  project := private.require_order_conversation_access(p_order_id);
  perform private.require_tickets_write(private.current_tenant_id());

  select * into actor from private.current_ticket_actor();
  if p_internal_note and actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission(case when p_internal_note then 'tickets.internal_notes' else 'tickets.reply' end);

  perform 1 from public.orders where id = project.id for update;
  select * into linked from public.tickets where order_id = project.id for update;
  if linked.id is not null then
    perform private.require_ticket_access(linked.id);
    if linked.company_id is distinct from project.company_id then
      raise exception 'Ticket company does not match Project' using errcode = '42501';
    end if;
    if linked.archived_at is not null or (not p_internal_note and linked.status = 'closed') then
      raise exception 'Ticket is not open for replies' using errcode = '55000';
    end if;
    if p_internal_note then
      perform public.app_add_ticket_internal_note(p_request_id, linked.id, p_body);
    else
      perform public.app_reply_to_ticket(p_request_id, linked.id, p_body);
    end if;
    return linked.id;
  end if;

  if p_internal_note then
    raise exception 'Project conversations do not support internal notes' using errcode = '0A000';
  end if;
  payload := jsonb_build_object('order_id', p_order_id, 'body', p_body, 'internal_note', false);
  previous_id := private.find_create_request(actor.profile_id, 'order.message', p_request_id, payload);
  if previous_id is not null then return project.id; end if;

  perform private.consume_rate_limit(
    case when actor.role_name = 'client' then 'ticket.reply.client.minute' else 'ticket.reply.internal.minute' end,
    actor.profile_id::text, interval '1 minute', case when actor.role_name = 'client' then 10 else 30 end
  );
  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id
  ) values (
    project.id,
    actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    btrim(p_body),
    p_request_id
  ) returning * into message_row;
  perform private.remember_create_request(
    actor.profile_id, 'order.message', p_request_id, payload, message_row.id
  );
  return project.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_reply_to_order_message(p_order_id uuid, p_request_id uuid, p_body text, p_reply_to_message_id uuid, p_reply_to_attachment_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  project public.orders;
  actor record;
  linked public.tickets;
  source_row public.project_messages;
  message_row public.project_messages;
  existing_id uuid;
  clean_quote text;
  payload jsonb;
begin
  if p_request_id is null or p_reply_to_message_id is null
     or nullif(btrim(p_body), '') is null or char_length(p_body) > 50000
     or octet_length(p_body) > 200000 then
    raise exception 'invalid Project reply input' using errcode = '22023';
  end if;
  project := private.require_order_conversation_access(p_order_id);
  perform private.require_tickets_write(private.current_tenant_id());

  select * into actor from private.current_ticket_actor();
  perform private.require_permission('tickets.reply');
  select * into linked from public.tickets where order_id = project.id;
  if linked.id is not null then
    perform public.app_reply_to_ticket_message(
      p_request_id, linked.id, p_body, p_reply_to_message_id, p_reply_to_attachment_id
    );
    return linked.id;
  end if;

  select * into source_row from public.project_messages
  where id = p_reply_to_message_id and order_id = project.id;
  if source_row.id is null then
    raise exception 'reply source is unavailable' using errcode = '42501';
  end if;
  if p_reply_to_attachment_id is not null and not exists (
    select 1 from public.project_attachments
    where id = p_reply_to_attachment_id and project_message_id = source_row.id
  ) then
    raise exception 'reply attachment target is invalid' using errcode = '22023';
  end if;

  clean_quote := left(regexp_replace(private.team_message_plain_text(source_row.body), '\s+', ' ', 'g'), 500);
  if nullif(btrim(replace(clean_quote, chr(65532), '')), '') is null then
    if p_reply_to_attachment_id is not null then
      select case when attachment.mime_type like 'image/%' then 'Image' else 'Attachment' end
      into clean_quote from public.project_attachments as attachment
      where attachment.id = p_reply_to_attachment_id;
    else
      select case
        when count(*) = 0 then 'Message'
        when count(*) = count(*) filter (where attachment.mime_type like 'image/%') then 'Image'
        else 'Attachment'
      end into clean_quote
      from public.project_attachments as attachment
      where attachment.project_message_id = source_row.id;
    end if;
    clean_quote := coalesce(clean_quote, 'Message');
  end if;

  payload := jsonb_build_object(
    'order_id', project.id, 'body', p_body,
    'reply_to_message_id', p_reply_to_message_id,
    'reply_to_attachment_id', p_reply_to_attachment_id
  );
  existing_id := private.find_create_request(actor.profile_id, 'order.reply_to_message', p_request_id, payload);
  if existing_id is not null then return project.id; end if;
  perform private.consume_rate_limit(
    case when actor.role_name = 'client' then 'ticket.reply.client.minute' else 'ticket.reply.internal.minute' end,
    actor.profile_id::text, interval '1 minute', case when actor.role_name = 'client' then 10 else 30 end
  );
  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id,
    reply_to_message_id, reply_to_attachment_id, reply_quote_text
  ) values (
    project.id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    btrim(p_body), p_request_id, source_row.id, p_reply_to_attachment_id, clean_quote
  ) returning * into message_row;
  perform private.remember_create_request(
    actor.profile_id, 'order.reply_to_message', p_request_id, payload, message_row.id
  );
  return project.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_toggle_order_message_reaction(p_order_id uuid, p_message_id uuid, p_reaction_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  linked public.tickets;
  source_row public.project_messages;
  actor record;
  now_active boolean;
begin
  perform private.require_order_conversation_access(p_order_id);
  perform private.require_tickets_write(private.current_tenant_id());

  select * into linked from public.tickets where order_id = p_order_id;
  if linked.id is not null then
    return public.app_toggle_ticket_message_reaction(p_message_id, p_reaction_code);
  end if;
  select * into source_row from public.project_messages
  where id = p_message_id and order_id = p_order_id;
  if source_row.id is null then raise exception 'message not found' using errcode = 'P0002'; end if;
  select * into actor from private.current_ticket_actor();
  perform private.require_permission('tickets.reply');
  if p_reaction_code is null or p_reaction_code not in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  ) then raise exception 'invalid reaction code' using errcode = '22023'; end if;
  perform private.consume_rate_limit(
    'ticket.reaction.actor', actor.profile_id::text, interval '1 minute', 60
  );
  insert into public.project_message_reactions as reaction (
    message_id, reactor_profile_id, reaction_code, active, created_at, updated_at
  ) values (
    p_message_id, actor.profile_id, p_reaction_code, true, clock_timestamp(), clock_timestamp()
  ) on conflict (message_id, reactor_profile_id, reaction_code)
  do update set active = not reaction.active, updated_at = clock_timestamp()
  returning reaction.active into now_active;
  return jsonb_build_object(
    'message_id', p_message_id,
    'reacted_by_me', now_active,
    'reactions', private.project_message_reactions_json(p_message_id, actor.profile_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_set_client_conversation_presence(p_conversation_type text, p_conversation_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor record;
  stable_event_key text;
begin
  if p_conversation_type not in ('ticket', 'project')
     or p_conversation_id is null
     or p_active is null then
    raise exception 'invalid conversation presence input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name <> 'client' then
    raise exception 'client conversation access is required' using errcode = '42501';
  end if;

  perform private.require_tickets_write(private.current_tenant_id());

  if p_conversation_type = 'ticket' then
    perform private.require_ticket_access(p_conversation_id);
  else
    perform private.require_order_conversation_access(p_conversation_id);
  end if;

  stable_event_key := 'client-conversation:' || p_conversation_type || ':' || p_conversation_id::text;

  if p_active then
    insert into private.client_conversation_presence (
      profile_id, conversation_type, conversation_id, active_at
    ) values (
      actor.profile_id, p_conversation_type, p_conversation_id, now()
    )
    on conflict (profile_id) do update set
      conversation_type = excluded.conversation_type,
      conversation_id = excluded.conversation_id,
      active_at = excluded.active_at;

    update public.notifications
    set read_at = coalesce(read_at, now())
    where recipient_profile_id = actor.profile_id
      and notifications.event_key = stable_event_key
      and read_at is null;
  else
    delete from private.client_conversation_presence
    where profile_id = actor.profile_id
      and conversation_type = p_conversation_type
      and conversation_id = p_conversation_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_submit_form(p_request_id uuid, p_form_version_id uuid, p_context jsonb, p_values jsonb, p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS form_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_class text;
  form_tenant_id uuid;
  form_visibility text;
  actor_company_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  assignment_row public.form_assignments;
  submission_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  company_id_value uuid;
  client_profile_id_value uuid;
  order_id_value uuid;
  orchestration_type_value text;
  orchestration_status_value text := 'not_required';
  existing_id uuid;
  identity_key text;
  request_payload jsonb := jsonb_build_object(
    'form_version_id', p_form_version_id,
    'context', coalesce(p_context, '{}'::jsonb) - 'bot_token',
    'values', p_values,
    'files', coalesce(p_files, '[]'::jsonb)
  );
begin
  if p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or p_context - array[
      'assignment_id', 'order_id', 'company_id', 'client_profile_id', 'bot_token'
    ] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  if p_context ? 'bot_token'
    and (jsonb_typeof(p_context -> 'bot_token') <> 'string'
      or char_length(p_context ->> 'bot_token') > 4096)
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  -- Size first: an oversized payload is rejected before it is parsed field by
  -- field, and before any lock is taken.
  perform private.enforce_form_payload_limits(p_values);

  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then
    raise exception 'Form file upload storage boundary is not available'
      using errcode = '55000';
  end if;

  -- The Form decides the Tenant. A signed-in caller acts through its active
  -- membership in the Form's Tenant (the selected Tenant), never its global
  -- role. Without one, a public Form takes the caller as an anonymous guest;
  -- any other Form refuses it.
  if actor_id is not null then
    select form.tenant_id, form.visibility
    into form_tenant_id, form_visibility
    from public.form_versions as version
    join public.forms as form on form.id = version.form_id
    where version.id = p_form_version_id;

    if form_tenant_id is null
      or form_tenant_id = (select private.current_tenant_id())
    then
      actor_class := (select private.current_account_class());
    end if;

    if actor_class is null
      and form_visibility = 'public'
      and exists (
        select 1 from public.profiles as profile
        where profile.id = actor_id and profile.archived_at is null
      )
    then
      actor_id := null;
    end if;
  end if;

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id
      and profile.archived_at is null;

    if actor_profile.id is null or actor_class is null then
      raise exception 'active Form submitter is required' using errcode = '42501';
    end if;
  end if;

  -- Every authenticated client submission reauthorizes the portal module
  -- before the idempotency lookup, so revoking Forms access is immediate.
  if actor_class = 'client' then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');

    actor_company_id := private.current_user_company_id();
    if actor_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    -- Preliminary ownership check for client submissions carrying an
    -- assignment id. It intentionally does not require status = assigned:
    -- the Intake/Onboarding path re-validates the exact Form, version and
    -- status below, and every other Form type refuses an assignment id.
    if p_context ? 'assignment_id' then
      select assignment.* into assignment_row
      from public.form_assignments as assignment
      where assignment.id = (p_context ->> 'assignment_id')::uuid
        and assignment.archived_at is null;

      if assignment_row.id is null
        or assignment_row.company_id <> actor_company_id
        or assignment_row.client_profile_id <> actor_id
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  existing_id := private.find_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload
  );
  if existing_id is not null then
    select * into submission_row
    from public.form_submissions
    where id = existing_id;
    if submission_row.id is null then raise no_data_found; end if;
    return submission_row;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.lifecycle_state = 'published'
  for share;
  if version_row.id is null then raise no_data_found; end if;

  select form.* into form_row
  from public.forms as form
  where form.id = version_row.form_id
    and form.status = 'published'
    and form.archived_at is null
    and form.published_version_id = version_row.id
    -- KI-138: only an active owning Tenant's Form accepts submissions. Same
    -- refusal as an unavailable Form, so the Tenant status is not disclosed.
    and exists (
      select 1 from public.tenants as tenant
      where tenant.id = form.tenant_id
        and tenant.status = 'active'
        and tenant.archived_at is null
    )
  for share;
  if form_row.id is null then
    raise exception 'Form version is unavailable for submission'
      using errcode = '55000';
  end if;

  if form_row.visibility = 'public' then
    if form_row.form_type not in ('order', 'contact') then
      raise exception 'assigned Form cannot be public' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'assigned' then
    if actor_id is null or not p_context ? 'assignment_id' then
      raise exception 'Form assignment is required' using errcode = '42501';
    end if;
  end if;

  -- M-03. The Form is known and this is not a replay, so throttle now. Every
  -- write below this line is inside the same transaction, so a raise here
  -- leaves no submission, no values, no activity, no Ticket and no
  -- notification behind.
  identity_key := private.form_submission_identity_key(version_row.id, p_values);
  perform private.enforce_form_submission_rate(form_row.id, actor_id, identity_key);

  if form_row.visibility = 'public' then
    perform private.require_bot_verification(
      'form.submit', form_row.id::text, p_context ->> 'bot_token'
    );
  end if;

  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;

    if assignment_row.id is null then
      raise exception 'active Form assignment is required' using errcode = '42501';
    end if;

    if actor_class = 'client' and (
      actor_company_id <> assignment_row.company_id
      or actor_id <> assignment_row.client_profile_id
    ) then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if actor_class <> 'client'
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;

    if actor_class <> 'client'
      and form_row.tenant_id <> (select private.current_tenant_id())
    then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    -- The assignment's stored Form relationship is authoritative. Order and
    -- Contact Forms are never legitimately submitted with an assignment id
    -- (the renderer only sends one for assigned Forms, and app_assign_form
    -- only creates assignments for Intake and Onboarding Forms), so refuse
    -- instead of completing someone's onboarding assignment with an
    -- unrelated submission.
    if p_context ? 'assignment_id' then
      raise exception 'Form assignment does not match the submitted Form'
        using errcode = '42501';
    end if;

    if actor_class = 'client' then
      company_id_value := actor_company_id;
      client_profile_id_value := actor_profile.id;
    elsif actor_id is not null
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;
  end if;

  if p_context ? 'company_id'
    and (p_context ->> 'company_id')::uuid is distinct from company_id_value
  then
    raise exception 'Form company context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'client_profile_id'
    and (p_context ->> 'client_profile_id')::uuid is distinct from client_profile_id_value
  then
    raise exception 'Form client context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'order_id'
    and (p_context ->> 'order_id')::uuid is distinct from order_id_value
  then
    raise exception 'Form Order context cannot be spoofed' using errcode = '42501';
  end if;

  perform private.validate_form_submission_values(version_row.id, p_values);

  if form_row.form_type = 'order' then
    orchestration_type_value := 'order_checkout';
    orchestration_status_value := 'deferred';
  elsif form_row.form_type = 'contact' then
    perform private.lock_tenant_module_lifecycle(form_row.tenant_id);
    if private.tenant_module_allowed(form_row.tenant_id,'tickets') then
      orchestration_type_value := 'contact_ticket';
      orchestration_status_value := 'deferred';
    end if;
  end if;

  submission_row.id := gen_random_uuid();
  insert into public.form_submissions (
    id,
    form_id,
    form_version_id,
    form_assignment_id,
    company_id,
    client_profile_id,
    order_id,
    root_submission_id,
    revision_number,
    orchestration_type,
    orchestration_status,
    submitted_by_profile_id,
    provenance
  ) values (
    submission_row.id,
    form_row.id,
    version_row.id,
    assignment_row.id,
    company_id_value,
    client_profile_id_value,
    order_id_value,
    submission_row.id,
    1,
    orchestration_type_value,
    orchestration_status_value,
    actor_id,
    jsonb_build_object(
      'form_type', form_row.form_type,
      'schema_hash', version_row.schema_hash,
      'type_config', version_row.type_config,
      'orchestration_deferred', orchestration_status_value = 'deferred',
      'tickets_enabled_at_submission', case when form_row.form_type='contact'
        then coalesce(orchestration_type_value='contact_ticket',false) else null end
    )
  ) returning * into submission_row;

  for submitted_value in
    select value from jsonb_array_elements(p_values)
  loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;

    insert into public.form_submission_values (
      submission_id,
      form_version_field_id,
      stable_field_key,
      field_label_snapshot,
      field_type_snapshot,
      sort_order_snapshot,
      value
    ) values (
      submission_row.id,
      field_row.id,
      field_row.stable_field_key,
      field_row.label,
      field_row.field_type,
      field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if assignment_row.id is not null then
    update public.form_assignments
    set
      status = 'completed',
      completed_at = now(),
      latest_submission_id = submission_row.id
    where id = assignment_row.id;
  end if;

  -- private.record_form_activity takes auth.uid(); a guest is recorded with
  -- no actor, like an anonymous visitor.
  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'form_submission',
    submission_row.id,
    'form.submitted',
    format('Submitted %s Form.', initcap(form_row.form_type)),
    jsonb_build_object(
      'form_id', form_row.id,
      'form_version_id', version_row.id,
      'assignment_id', assignment_row.id,
      'company_id', company_id_value,
      'order_id', order_id_value
    )
  );
  perform private.remember_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload,
    submission_row.id
  );
  return submission_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_ticket_from_contact_submission(p_submission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  submission_row public.form_submissions;
  version_row public.form_versions;
  subject_key uuid;
  message_key uuid;
  subject_value text;
  message_value text;
  requester_name_value text;
  requester_email_value text;
  actor_class text;
  ticket_row public.tickets;
  message_row public.ticket_messages;
begin
  select submission.* into submission_row
  from public.form_submissions as submission
  where submission.id = p_submission_id
    and submission.orchestration_type = 'contact_ticket'
    and submission.orchestration_status = 'deferred'
  for update;
  if submission_row.id is null then
    select id into ticket_row.id from public.tickets where source_form_submission_id = p_submission_id;
    return ticket_row.id;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = submission_row.form_version_id;
  if version_row.id is null then return null; end if;

  perform private.lock_tenant_module_lifecycle((select tenant_id from public.forms where id=submission_row.form_id));
  if not private.tenant_module_allowed((select tenant_id from public.forms where id=submission_row.form_id),'tickets') then
    return null;
  end if;

  subject_key := (version_row.type_config ->> 'subject_field_key')::uuid;
  message_key := (version_row.type_config ->> 'message_field_key')::uuid;
  select value #>> '{}' into subject_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = subject_key;
  select value #>> '{}' into message_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = message_key;
  if nullif(btrim(subject_value), '') is null or nullif(btrim(message_value), '') is null then
    return null;
  end if;

  select value #>> '{}' into requester_email_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'email'
  order by sort_order_snapshot limit 1;
  select coalesce(value #>> '{}', value ->> 'full') into requester_name_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'fullname'
  order by sort_order_snapshot limit 1;

  if submission_row.submitted_by_profile_id is not null then
    -- The submitter's class in the Form's Tenant, not the global role.
    select membership_row.account_class into actor_class
    from public.tenant_memberships as membership_row
    join public.forms as form_row
      on form_row.tenant_id = membership_row.tenant_id
    where form_row.id = submission_row.form_id
      and membership_row.profile_id = submission_row.submitted_by_profile_id
      and membership_row.archived_at is null;
  end if;

  insert into public.tickets (
    tenant_id,
    company_id, client_profile_id, requester_name, requester_email,
    subject, status, priority, created_by_profile_id,
    source_form_submission_id, source_form_version_id
  ) values (
    (select form_row.tenant_id from public.forms as form_row where form_row.id = submission_row.form_id),
    submission_row.company_id, submission_row.client_profile_id,
    nullif(btrim(requester_name_value), ''), nullif(btrim(requester_email_value), ''),
    btrim(subject_value), 'open', 'normal', submission_row.submitted_by_profile_id,
    submission_row.id, submission_row.form_version_id
  )
  on conflict (source_form_submission_id) do nothing
  returning * into ticket_row;

  if ticket_row.id is null then
    select * into ticket_row from public.tickets where source_form_submission_id = submission_row.id;
    return ticket_row.id;
  end if;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body
  ) values (
    ticket_row.id,
    submission_row.submitted_by_profile_id,
    case when submission_row.submitted_by_profile_id is null then 'guest'
      when actor_class = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(message_value)
  ) returning * into message_row;

  update public.form_submissions
  set orchestration_status = 'completed',
      provenance = provenance || jsonb_build_object('ticket_id', ticket_row.id)
  where id = submission_row.id;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket from Contact Form.',
    jsonb_build_object(
      'form_submission_id', submission_row.id,
      'form_version_id', submission_row.form_version_id,
      'initial_message_id', message_row.id
    ), submission_row.submitted_by_profile_id
  );
  return ticket_row.id;
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
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
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
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
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
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
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

CREATE OR REPLACE FUNCTION public.app_list_investment_intents(p_limit integer DEFAULT 200)
 RETURNS TABLE(intent_id uuid, company_id uuid, company_name text, service_id uuid, service_name text, folder_name text, price numeric, currency text, recurring boolean, recurring_price numeric, recurring_interval_length integer, recurring_interval_unit text, status text, in_cart boolean, add_count integer, first_added_at timestamp with time zone, last_added_at timestamp with time zone, removed_at timestamp with time zone, last_activity_at timestamp with time zone, contacted_at timestamp with time zone, contacted_by_profile_id uuid, contacted_by_name text, updated_at timestamp with time zone, active_ticket_id uuid, active_ticket_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  row_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  perform public.app_require_module_access('investment_intent');

  return query
  select
    interest.id,
    interest.company_id,
    company_row.name,
    interest.service_id,
    service_row.name,
    folder_row.name,
    service_row.price,
    service_row.currency,
    service_row.recurring,
    service_row.recurring_price,
    service_row.recurring_interval_length,
    service_row.recurring_interval_unit,
    interest.status,
    interest.in_cart,
    interest.add_count,
    interest.first_added_at,
    interest.last_added_at,
    interest.removed_at,
    interest.last_activity_at,
    interest.contacted_at,
    interest.contacted_by_profile_id,
    contacted_profile.display_name,
    interest.updated_at,
    active_ticket.id,
    active_ticket.status
  from public.service_interests as interest
  join public.companies as company_row
    on company_row.id = interest.company_id
  join public.services as service_row
    on service_row.id = interest.service_id
  left join public.service_folders as folder_row
    on folder_row.id = service_row.folder_id
  left join public.profiles as contacted_profile
    on contacted_profile.id = interest.contacted_by_profile_id
  -- tickets_active_investment_conversation_unique guarantees at most one live
  -- conversation per (company_id, investment_service_id), so this left join can
  -- never fan one interest row out into two.
  left join public.tickets as active_ticket
    on active_ticket.company_id = interest.company_id
   and active_ticket.investment_service_id = interest.service_id
   and active_ticket.status not in ('resolved', 'closed')
   and private.can_access_ticket(active_ticket.id)
  where interest.tenant_id = (select private.current_tenant_id())
  order by interest.last_activity_at desc, interest.id
  limit row_limit;
end;
$function$;

create trigger tickets_published_module_write before insert or update on public.tickets
for each row execute function private.enforce_ticket_module_write();
create trigger ticket_messages_published_module_write before insert or update on public.ticket_messages
for each row execute function private.enforce_ticket_module_write();
create trigger ticket_attachments_published_module_write before insert or update on public.ticket_attachments
for each row execute function private.enforce_ticket_module_write();
create trigger ticket_message_reactions_published_module_write before insert or update on public.ticket_message_reactions
for each row execute function private.enforce_ticket_module_write();
create trigger project_messages_published_module_write before insert or update on public.project_messages
for each row execute function private.enforce_ticket_module_write();
create trigger project_attachments_published_module_write before insert or update on public.project_attachments
for each row execute function private.enforce_ticket_module_write();
create trigger project_message_reactions_published_module_write before insert or update on public.project_message_reactions
for each row execute function private.enforce_ticket_module_write();
