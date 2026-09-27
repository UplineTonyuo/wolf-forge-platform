-- Client conversation notifications are one unread row per conversation, and
-- new Projects use the Project-native conversation tables. Historical
-- Ticket-backed Project conversations remain untouched and continue through
-- the legacy branch of the Order conversation RPCs.

alter table public.notifications
  add column if not exists message_count integer not null default 1,
  add constraint notifications_message_count_positive check (message_count > 0);

create table private.client_conversation_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  conversation_type text not null check (conversation_type in ('ticket', 'project')),
  conversation_id uuid not null,
  active_at timestamptz not null default now()
);

revoke all on table private.client_conversation_presence
  from public, anon, authenticated, service_role;

create index client_conversation_presence_active_idx
  on private.client_conversation_presence (conversation_type, conversation_id, active_at);

create function public.app_set_client_conversation_presence(
  p_conversation_type text,
  p_conversation_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.app_set_client_conversation_presence(text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.app_set_client_conversation_presence(text, uuid, boolean)
  to authenticated;

create function private.emit_client_conversation_notification(
  p_company_id uuid,
  p_required_permission_key text,
  p_conversation_type text,
  p_conversation_id uuid,
  p_category text,
  p_sender_name text,
  p_subject text,
  p_href text,
  p_actor_profile_id uuid,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_event_key text :=
    'client-conversation:' || p_conversation_type || ':' || p_conversation_id::text;
  sender_name text := coalesce(nullif(btrim(p_sender_name), ''), 'Wolf Forge');
begin
  insert into public.notifications (
    recipient_profile_id, company_id, audience, category, variant,
    title, body, href, entity_type, entity_id, actor_profile_id,
    event_key, message_count, created_at
  )
  select
    profile_row.id,
    p_company_id,
    'client',
    p_category,
    'info',
    'New message from ' || sender_name,
    coalesce(nullif(btrim(p_subject), ''), 'Wolf Forge conversation'),
    p_href,
    p_conversation_type,
    p_conversation_id,
    p_actor_profile_id,
    stable_event_key,
    1,
    coalesce(p_created_at, now())
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  where role_row.name = 'client'
    and profile_row.archived_at is null
    and profile_row.company_id = p_company_id
    and private.profile_has_permission(profile_row.id, p_required_permission_key)
    and not exists (
      select 1
      from private.client_conversation_presence as presence
      where presence.profile_id = profile_row.id
        and presence.conversation_type = p_conversation_type
        and presence.conversation_id = p_conversation_id
        and presence.active_at >= now() - interval '45 seconds'
    )
  on conflict (recipient_profile_id, event_key) do update set
    company_id = excluded.company_id,
    category = excluded.category,
    variant = excluded.variant,
    title = case
      when notifications.read_at is null then
        (notifications.message_count + 1)::text || ' new messages from ' || sender_name
      else 'New message from ' || sender_name
    end,
    body = excluded.body,
    href = excluded.href,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    actor_profile_id = excluded.actor_profile_id,
    message_count = case
      when notifications.read_at is null then notifications.message_count + 1
      else 1
    end,
    read_at = null,
    created_at = excluded.created_at;
end;
$$;

revoke all on function private.emit_client_conversation_notification(
  uuid, text, text, uuid, text, text, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.notify_client_ticket_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_role text;
  author_name text;
  ticket_row public.tickets;
  conversation_type text;
  conversation_id uuid;
  notification_category text;
  notification_href text;
  notification_subject text;
  required_permission text;
begin
  if new.message_kind is distinct from 'reply'
     or new.visibility is distinct from 'client'
     or new.author_profile_id is null then
    return new;
  end if;

  select role_row.name, profile_row.display_name
  into author_role, author_name
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  where profile_row.id = new.author_profile_id;

  if author_role is null or author_role not in ('owner', 'admin', 'manager', 'staff') then
    return new;
  end if;

  select * into ticket_row from public.tickets where id = new.ticket_id;
  if ticket_row.id is null then return new; end if;

  if ticket_row.order_id is null then
    conversation_type := 'ticket';
    conversation_id := ticket_row.id;
    notification_category := 'ticket';
    notification_href := '/account/messages/' || ticket_row.id::text;
    notification_subject := ticket_row.subject;
    required_permission := 'tickets.view';
  else
    conversation_type := 'project';
    conversation_id := ticket_row.order_id;
    notification_category := 'project';
    notification_href := '/account/projects/' || ticket_row.order_id::text;
    select orders.title into notification_subject
    from public.orders where orders.id = ticket_row.order_id;
    required_permission := 'projects.view';
  end if;

  perform private.emit_client_conversation_notification(
    ticket_row.company_id,
    required_permission,
    conversation_type,
    conversation_id,
    notification_category,
    author_name,
    notification_subject,
    notification_href,
    new.author_profile_id,
    now()
  );

  return new;
end;
$$;

create function private.notify_client_project_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_role text;
  author_name text;
  project public.orders;
begin
  if new.author_type is distinct from 'internal' or new.author_profile_id is null then
    return new;
  end if;

  select role_row.name, profile_row.display_name
  into author_role, author_name
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  where profile_row.id = new.author_profile_id;

  if author_role is null or author_role not in ('owner', 'admin', 'manager', 'staff') then
    return new;
  end if;

  select * into project from public.orders where id = new.order_id;
  if project.id is null then return new; end if;

  perform private.emit_client_conversation_notification(
    project.company_id,
    'projects.view',
    'project',
    project.id,
    'project',
    author_name,
    project.title,
    '/account/projects/' || project.id::text,
    new.author_profile_id,
    now()
  );

  return new;
end;
$$;

revoke all on function private.notify_client_project_response()
  from public, anon, authenticated, service_role;

drop trigger if exists notifications_client_project_response on public.project_messages;
create trigger notifications_client_project_response
after insert on public.project_messages
for each row execute function private.notify_client_project_response();

-- Keep historical Ticket-backed Project conversations readable. New Projects
-- read directly from the already-established native Project message model.
create or replace function public.app_get_order_conversation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.orders;
  linked public.tickets;
  native jsonb;
  shaped_messages jsonb;
begin
  project := private.require_order_conversation_access(p_order_id);
  select * into linked from public.tickets where order_id = project.id;
  if linked.id is not null then
    if linked.company_id is distinct from project.company_id then
      raise exception 'Ticket company does not match Project' using errcode = '42501';
    end if;
    return public.app_get_ticket_detail_with_avatars(linked.id);
  end if;

  native := public.app_get_project_conversation(project.id);
  select coalesce(jsonb_agg(
    message.value || jsonb_build_object(
      'ticket_id', project.id,
      'message_kind', case when message.value ->> 'author_type' = 'system'
        then 'initial_request' else 'reply' end,
      'visibility', 'client',
      'reply_source_author_name', source_author.display_name,
      'reply_source_available', (message.value ->> 'reply_to_message_id') is not null,
      'unsent_at', null,
      'can_unsend', false
    ) order by (message.value ->> 'created_at')::timestamptz, message.value ->> 'id'
  ), '[]'::jsonb)
  into shaped_messages
  from jsonb_array_elements(native -> 'messages') as message(value)
  left join public.project_messages as source_message
    on source_message.id = nullif(message.value ->> 'reply_to_message_id', '')::uuid
  left join public.profiles as source_author
    on source_author.id = source_message.author_profile_id;

  return jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', project.id,
      'public_ref', 'PROJECT-' || project.order_number::text,
      'subject', project.title,
      'status', 'open',
      'priority', project.priority,
      'requester_name', null,
      'created_at', project.created_at,
      'updated_at', project.updated_at,
      'resolved_at', null,
      'closed_at', null,
      'archived_at', project.archived_at
    ),
    'company_name', (select company.name from public.companies as company where company.id = project.company_id),
    'client_name', null,
    'assigned_to_name', (select profile.display_name from public.profiles as profile where profile.id = project.assigned_to_profile_id),
    'messages', shaped_messages
  );
end;
$$;

-- One shared write boundary. It delegates for historical linked Tickets and
-- writes native rows for every Project that has no legacy Ticket.
create or replace function public.app_send_order_message(
  p_order_id uuid,
  p_request_id uuid,
  p_body text,
  p_internal_note boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.app_reply_to_order_message(
  p_order_id uuid,
  p_request_id uuid,
  p_body text,
  p_reply_to_message_id uuid,
  p_reply_to_attachment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.app_get_order_conversation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.app_send_order_message(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.app_reply_to_order_message(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_order_conversation(uuid) to authenticated;
grant execute on function public.app_send_order_message(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.app_reply_to_order_message(uuid, uuid, text, uuid, uuid) to authenticated;

create or replace function public.app_purchase_service_with_balance(
  p_request_id uuid,
  p_service_id uuid,
  p_coupon_code text default null
)
returns table (
  order_id uuid,
  order_number bigint,
  ticket_id uuid,
  ticket_public_ref text,
  invoice_id uuid,
  invoice_number bigint,
  payment_id uuid,
  amount_cents bigint,
  currency text,
  wallet_balance_cents bigint,
  service_name text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
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

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id
   and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

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
    select * into order_row from public.orders where id = existing_id;
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

  perform private.consume_rate_limit(
    'store.purchase.client.hour', actor_id::text, interval '1 hour', 10
  );
  perform private.consume_rate_limit(
    'store.purchase.client.day', actor_id::text, interval '1 day', 40
  );

  select * into service_row
  from public.services as service
  where service.id = p_service_id
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
$$;

revoke all on function public.app_purchase_service_with_balance(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_purchase_service_with_balance(uuid, uuid, text)
  to authenticated;

comment on function public.app_purchase_service_with_balance(uuid, uuid, text) is
  'Atomic, retry-safe Store purchase. Creates one Project with one native Project conversation and no Ticket; payment, invoice, wallet and coupon authority remain server-resolved.';

create or replace function private.prepare_ticket_attachment(
  p_request_id uuid,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_reply_to_message_id uuid default null,
  p_consume_rate_limit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.app_send_ticket_message_with_attachment(
  p_request_id uuid,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_body text default '',
  p_reply_to_message_id uuid default null,
  p_original_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_checksum_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor record; prepared jsonb; expected_key text; send_body text := coalesce(p_body, '');
  linked public.tickets; ticket_message public.ticket_messages; ticket_attachment public.ticket_attachments;
  project_message public.project_messages; project_attachment public.project_attachments;
  quote_text text;
begin
  if char_length(send_body) > 50000 or octet_length(send_body) > 200000
     or p_original_name is null or btrim(p_original_name) = ''
     or char_length(p_original_name) > 255
     or p_original_name ~ '[\\/]' or p_original_name ~ '[[:cntrl:]]'
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif',
       'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf')
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid Ticket attachment' using errcode = '22023';
  end if;
  prepared := private.prepare_ticket_attachment(
    p_request_id, p_ticket_id, p_order_id, p_reply_to_message_id, false
  );
  expected_key := prepared ->> 'storage_key';
  if not exists (select 1 from storage.objects
    where bucket_id = 'ticket-attachments' and name = expected_key) then
    raise exception 'Ticket attachment upload is missing' using errcode = '22023';
  end if;
  select * into actor from private.current_ticket_actor();

  if p_order_id is not null then
    select * into linked from public.tickets where order_id = p_order_id;
  else
    select * into linked from public.tickets where id = p_ticket_id;
  end if;
  if linked.id is not null then
    perform set_config('app.ticket_attachment_message', 'on', true);
    if nullif(btrim(send_body), '') is null then send_body := U&'\FFFC'; end if;
    if p_order_id is not null then
      if p_reply_to_message_id is not null then
        ticket_message := public.app_reply_to_ticket_message(
          p_request_id, linked.id, send_body, p_reply_to_message_id, null
        );
      else
        perform public.app_send_order_message(p_order_id, p_request_id, send_body, false);
        select * into ticket_message from public.ticket_messages
        where ticket_id = linked.id and request_id = p_request_id;
      end if;
    elsif p_reply_to_message_id is not null then
      ticket_message := public.app_reply_to_ticket_message(
        p_request_id, linked.id, send_body, p_reply_to_message_id, null
      );
    else
      ticket_message := public.app_reply_to_ticket(p_request_id, linked.id, send_body);
    end if;
    insert into public.ticket_attachments (
      ticket_id, ticket_message_id, storage_object_key, original_name,
      mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
    ) values (
      linked.id, ticket_message.id, expected_key, p_original_name,
      p_mime_type, p_size_bytes, p_checksum_sha256, 'clean', actor.profile_id
    ) on conflict (storage_object_key) do nothing;
    select * into ticket_attachment from public.ticket_attachments where storage_object_key = expected_key;
    if ticket_attachment.ticket_id <> linked.id or ticket_attachment.ticket_message_id <> ticket_message.id
       or ticket_attachment.original_name <> p_original_name or ticket_attachment.mime_type <> p_mime_type
       or ticket_attachment.size_bytes <> p_size_bytes or ticket_attachment.checksum_sha256 <> p_checksum_sha256 then
      raise exception 'Ticket attachment request conflicts with an existing file' using errcode = '23505';
    end if;
    return jsonb_build_object('ticket_id', linked.id, 'message_id', ticket_message.id, 'attachment_id', ticket_attachment.id);
  end if;

  perform private.require_order_conversation_access(p_order_id);
  if p_reply_to_message_id is not null then
    select left(regexp_replace(private.team_message_plain_text(body), '\s+', ' ', 'g'), 500)
    into quote_text from public.project_messages
    where id = p_reply_to_message_id and order_id = p_order_id;
    if nullif(btrim(replace(quote_text, chr(65532), '')), '') is null then quote_text := 'Attachment'; end if;
  end if;
  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id,
    reply_to_message_id, reply_quote_text
  ) values (
    p_order_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    btrim(send_body), p_request_id, p_reply_to_message_id, quote_text
  ) on conflict (order_id, request_id) do nothing;
  select * into project_message from public.project_messages
  where order_id = p_order_id and request_id = p_request_id;
  if project_message.body is distinct from btrim(send_body)
     or project_message.reply_to_message_id is distinct from p_reply_to_message_id then
    raise exception 'Project attachment request conflicts with an existing message' using errcode = '23505';
  end if;
  insert into public.project_attachments (
    order_id, project_message_id, storage_object_key, original_name,
    mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
  ) values (
    p_order_id, project_message.id, expected_key, p_original_name,
    p_mime_type, p_size_bytes, p_checksum_sha256, 'clean', actor.profile_id
  ) on conflict (storage_object_key) do nothing;
  select * into project_attachment from public.project_attachments where storage_object_key = expected_key;
  if project_attachment.order_id <> p_order_id or project_attachment.project_message_id <> project_message.id
     or project_attachment.original_name <> p_original_name or project_attachment.mime_type <> p_mime_type
     or project_attachment.size_bytes <> p_size_bytes or project_attachment.checksum_sha256 <> p_checksum_sha256 then
    raise exception 'Project attachment request conflicts with an existing file' using errcode = '23505';
  end if;
  return jsonb_build_object('ticket_id', p_order_id, 'message_id', project_message.id, 'attachment_id', project_attachment.id);
end;
$$;

create or replace function public.app_get_ticket_attachment_download(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ticket_attachment public.ticket_attachments; ticket_row public.tickets;
  ticket_message public.ticket_messages; project_attachment public.project_attachments; actor record;
begin
  select * into ticket_attachment from public.ticket_attachments where id = p_attachment_id;
  if ticket_attachment.id is not null then
    if ticket_attachment.scan_status <> 'clean' then raise exception 'Ticket attachment not found' using errcode = 'P0002'; end if;
    ticket_row := private.require_ticket_access(ticket_attachment.ticket_id);
    if ticket_row.order_id is not null then perform private.require_order_conversation_access(ticket_row.order_id); end if;
    select * into actor from private.current_ticket_actor();
    select * into ticket_message from public.ticket_messages where id = ticket_attachment.ticket_message_id;
    if actor.role_name = 'client' and (ticket_message.visibility <> 'client' or ticket_message.message_kind = 'internal_note') then
      raise exception 'Ticket attachment not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('storage_object_key', ticket_attachment.storage_object_key,
      'mime_type', ticket_attachment.mime_type, 'original_name', ticket_attachment.original_name);
  end if;
  select * into project_attachment from public.project_attachments where id = p_attachment_id;
  if project_attachment.id is null or project_attachment.scan_status <> 'clean' then
    raise exception 'Ticket attachment not found' using errcode = 'P0002';
  end if;
  perform private.require_order_conversation_access(project_attachment.order_id);
  return jsonb_build_object('storage_object_key', project_attachment.storage_object_key,
    'mime_type', project_attachment.mime_type, 'original_name', project_attachment.original_name);
end;
$$;

create function public.app_toggle_order_message_reaction(
  p_order_id uuid,
  p_message_id uuid,
  p_reaction_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked public.tickets;
  source_row public.project_messages;
  actor record;
  now_active boolean;
begin
  perform private.require_order_conversation_access(p_order_id);
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
$$;

revoke all on function public.app_toggle_order_message_reaction(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_toggle_order_message_reaction(uuid, uuid, text)
  to authenticated;
