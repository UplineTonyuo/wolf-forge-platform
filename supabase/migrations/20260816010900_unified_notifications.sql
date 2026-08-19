-- Wolf Forge unified notification center.
-- Persistent, recipient-scoped, unread-aware notifications.
-- Direct table mutation is not exposed to application roles.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null
    references public.profiles(id) on delete cascade,
  company_id uuid null
    references public.companies(id) on delete set null,
  audience text not null,
  category text not null,
  variant text not null default 'info',
  title text not null,
  body text not null,
  href text not null,
  entity_type text null,
  entity_id uuid null,
  actor_profile_id uuid null
    references public.profiles(id) on delete set null,
  event_key text not null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint notifications_audience_valid
    check (audience in ('internal', 'client')),

  constraint notifications_category_valid
    check (
      category in (
        'project',
        'client',
        'form',
        'coupon',
        'ticket',
        'payment',
        'wallet'
      )
    ),

  constraint notifications_variant_valid
    check (variant in ('info', 'credit', 'debit')),

  constraint notifications_title_nonblank
    check (btrim(title) <> ''),

  constraint notifications_body_nonblank
    check (btrim(body) <> ''),

  constraint notifications_event_key_nonblank
    check (btrim(event_key) <> ''),

  constraint notifications_href_internal
    check (
      left(href, 1) = '/'
      and left(href, 2) <> '//'
    ),

  constraint notifications_recipient_event_unique
    unique (recipient_profile_id, event_key)
);

create index notifications_recipient_created_idx
  on public.notifications (
    recipient_profile_id,
    created_at desc
  );

create index notifications_recipient_unread_idx
  on public.notifications (
    recipient_profile_id,
    created_at desc
  )
  where read_at is null;

create index notifications_company_created_idx
  on public.notifications (
    company_id,
    created_at desc
  )
  where company_id is not null;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

revoke all on table public.notifications
  from public, anon, authenticated;

create policy notifications_select_own
on public.notifications
for select
to authenticated
using (recipient_profile_id = auth.uid());


-- ------------------------------------------------------------
-- Private emitters
-- ------------------------------------------------------------

create or replace function private.emit_internal_notification(
  p_event_key text,
  p_category text,
  p_variant text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_profile_id uuid,
  p_company_id uuid,
  p_created_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at
  )
  select
    profile.id,
    p_company_id,
    'internal',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now())
  from public.profiles as profile
  join public.roles as role
    on role.id = profile.role_id
  where role.name in ('owner', 'admin', 'manager', 'staff')
    and profile.archived_at is null
  on conflict (recipient_profile_id, event_key) do nothing;
$$;


create or replace function private.emit_company_client_notification(
  p_company_id uuid,
  p_event_key text,
  p_category text,
  p_variant text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_profile_id uuid,
  p_created_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at
  )
  select
    profile.id,
    p_company_id,
    'client',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now())
  from public.profiles as profile
  join public.roles as role
    on role.id = profile.role_id
  where role.name = 'client'
    and profile.archived_at is null
    and profile.company_id = p_company_id
  on conflict (recipient_profile_id, event_key) do nothing;
$$;


-- ------------------------------------------------------------
-- Read + unread RPC boundary
-- ------------------------------------------------------------

create or replace function public.app_list_my_notifications(
  p_limit integer default 50
)
returns table (
  id uuid,
  company_id uuid,
  audience text,
  category text,
  variant text,
  title text,
  body text,
  href text,
  entity_type text,
  entity_id uuid,
  actor_profile_id uuid,
  event_key text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if caller_id is null then
    raise exception 'authenticated notification access required'
      using errcode = '42501';
  end if;

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
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$$;


create or replace function public.app_mark_notification_read(
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  changed boolean;
begin
  if caller_id is null then
    raise exception 'authenticated notification access required'
      using errcode = '42501';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id
    and recipient_profile_id = caller_id;

  changed := found;
  return changed;
end;
$$;


create or replace function public.app_mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  changed integer;
begin
  if caller_id is null then
    raise exception 'authenticated notification access required'
      using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where recipient_profile_id = caller_id
    and read_at is null;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.app_list_my_notifications(integer)
  from public, anon, service_role;
revoke all on function public.app_mark_notification_read(uuid)
  from public, anon, service_role;
revoke all on function public.app_mark_all_notifications_read()
  from public, anon, service_role;

grant execute on function public.app_list_my_notifications(integer)
  to authenticated;
grant execute on function public.app_mark_notification_read(uuid)
  to authenticated;
grant execute on function public.app_mark_all_notifications_read()
  to authenticated;


-- ------------------------------------------------------------
-- Project created
-- ------------------------------------------------------------

create or replace function private.notify_project_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid :=
    nullif(payload ->> 'company_id', '')::uuid;
  project_title text :=
    coalesce(
      nullif(payload ->> 'title', ''),
      'New Project'
    );
begin
  perform private.emit_internal_notification(
    'project-created:' || new.id::text,
    'project',
    'info',
    'Project created',
    project_title,
    '/orders/' || new.id::text,
    'order',
    new.id,
    auth.uid(),
    company_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_project_created
  on public.orders;

create trigger notifications_project_created
after insert on public.orders
for each row
execute function private.notify_project_created();


-- ------------------------------------------------------------
-- Client created
-- Primary contacts and profile-backed client contacts represent
-- the Client creation boundary without notifying on every later
-- secondary contact.
-- ------------------------------------------------------------

create or replace function private.notify_client_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid :=
    nullif(payload ->> 'company_id', '')::uuid;
  profile_id uuid :=
    nullif(payload ->> 'profile_id', '')::uuid;
  contact_name text :=
    coalesce(
      nullif(payload ->> 'name', ''),
      'New client'
    );
  is_primary boolean :=
    coalesce(
      nullif(payload ->> 'is_primary', '')::boolean,
      false
    );
begin
  if not is_primary and profile_id is null then
    return new;
  end if;

  perform private.emit_internal_notification(
    'client-created:' || new.id::text,
    'client',
    'info',
    'Client created',
    contact_name,
    case
      when company_id is null then '/clients'
      else '/clients/' || company_id::text
    end,
    'client_contact',
    new.id,
    auth.uid(),
    company_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_client_created
  on public.client_contacts;

create trigger notifications_client_created
after insert on public.client_contacts
for each row
execute function private.notify_client_created();


-- ------------------------------------------------------------
-- Form created
-- ------------------------------------------------------------

create or replace function private.notify_form_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  form_name text :=
    coalesce(
      nullif(payload ->> 'name', ''),
      nullif(payload ->> 'canonical_key', ''),
      nullif(payload #>> '{definition,name}', ''),
      'New Form'
    );
begin
  perform private.emit_internal_notification(
    'form-created:' || new.id::text,
    'form',
    'info',
    'Form created',
    form_name,
    '/forms/' || new.id::text,
    'form',
    new.id,
    auth.uid(),
    null,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_form_created
  on public.forms;

create trigger notifications_form_created
after insert on public.forms
for each row
execute function private.notify_form_created();


-- ------------------------------------------------------------
-- Coupon created
-- ------------------------------------------------------------

create or replace function private.notify_coupon_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  coupon_code text :=
    coalesce(
      nullif(payload ->> 'code', ''),
      'New coupon'
    );
begin
  perform private.emit_internal_notification(
    'coupon-created:' || new.id::text,
    'coupon',
    'info',
    'Coupon created',
    coupon_code,
    '/coupons/' || new.id::text,
    'coupon',
    new.id,
    auth.uid(),
    null,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_coupon_created
  on public.coupons;

create trigger notifications_coupon_created
after insert on public.coupons
for each row
execute function private.notify_coupon_created();


-- ------------------------------------------------------------
-- Client Ticket reply
-- Internal replies and Internal Notes intentionally do not create
-- this notification.
-- ------------------------------------------------------------

create or replace function private.notify_client_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  ticket_id uuid :=
    nullif(payload ->> 'ticket_id', '')::uuid;
  author_id uuid :=
    nullif(payload ->> 'author_profile_id', '')::uuid;
  message_kind text :=
    payload ->> 'message_kind';
  author_role text;
  author_name text;
  ticket_ref text;
  ticket_subject text;
  company_id uuid;
begin
  if message_kind is distinct from 'reply'
     or author_id is null
     or ticket_id is null then
    return new;
  end if;

  select role.name, profile.display_name
  into author_role, author_name
  from public.profiles as profile
  join public.roles as role
    on role.id = profile.role_id
  where profile.id = author_id;

  if author_role is distinct from 'client' then
    return new;
  end if;

  select
    ticket.public_ref,
    ticket.subject,
    ticket.company_id
  into
    ticket_ref,
    ticket_subject,
    company_id
  from public.tickets as ticket
  where ticket.id = ticket_id;

  perform private.emit_internal_notification(
    'client-ticket-reply:' || new.id::text,
    'ticket',
    'info',
    'Client replied to ' ||
      coalesce(ticket_ref, 'a Ticket'),
    coalesce(
      nullif(author_name, ''),
      'A client'
    ) ||
      case
        when ticket_subject is null then ' sent a reply.'
        else ' replied to "' || ticket_subject || '".'
      end,
    '/tickets/' || ticket_id::text,
    'ticket',
    ticket_id,
    author_id,
    company_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_client_ticket_reply
  on public.ticket_messages;

create trigger notifications_client_ticket_reply
after insert on public.ticket_messages
for each row
execute function private.notify_client_ticket_reply();


-- ------------------------------------------------------------
-- Successful Invoice payment
-- Handles both rows inserted as succeeded and pending rows that
-- later transition to succeeded.
-- ------------------------------------------------------------

create or replace function private.notify_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  old_payload jsonb;
  payment_status text :=
    payload ->> 'status';
  previous_status text;
  invoice_id uuid :=
    nullif(payload ->> 'invoice_id', '')::uuid;
  payment_amount bigint :=
    coalesce(
      nullif(payload ->> 'amount_cents', '')::bigint,
      0
    );
  invoice_number bigint;
  invoice_status text;
  invoice_currency text;
  company_id uuid;
  company_name text;
  amount_label text;
begin
  if tg_op = 'UPDATE' then
    old_payload := to_jsonb(old);
    previous_status := old_payload ->> 'status';
  end if;

  if payment_status is distinct from 'succeeded' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and previous_status = 'succeeded' then
    return new;
  end if;

  if invoice_id is null then
    return new;
  end if;

  select
    invoice.invoice_number,
    invoice.status,
    invoice.currency,
    invoice.company_id,
    company.name
  into
    invoice_number,
    invoice_status,
    invoice_currency,
    company_id,
    company_name
  from public.invoices as invoice
  left join public.companies as company
    on company.id = invoice.company_id
  where invoice.id = invoice_id;

  amount_label :=
    coalesce(invoice_currency, 'USD') ||
    ' ' ||
    to_char(
      abs(payment_amount)::numeric / 100,
      'FM999999999999990.00'
    );

  perform private.emit_internal_notification(
    'invoice-payment:' || new.id::text,
    'payment',
    'credit',
    case
      when invoice_status = 'paid' then 'Invoice paid'
      else 'Invoice payment received'
    end,
    coalesce(company_name, 'Client') ||
      ' paid ' ||
      amount_label ||
      case
        when invoice_number is null then '.'
        else
          ' on Invoice #WF-' ||
          lpad(invoice_number::text, 4, '0') ||
          '.'
      end,
    '/invoices/' || invoice_id::text,
    'invoice',
    invoice_id,
    auth.uid(),
    company_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_invoice_payment
  on public.invoice_payments;

create trigger notifications_invoice_payment
after insert or update of status on public.invoice_payments
for each row
execute function private.notify_invoice_payment();


-- ------------------------------------------------------------
-- Positive Client wallet transaction
-- Internal actor -> Wolf Forge credited the client.
-- Client actor   -> client recharge.
-- A future real client recharge path automatically lands here.
-- ------------------------------------------------------------

create or replace function private.notify_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid :=
    nullif(payload ->> 'company_id', '')::uuid;
  actor_id uuid :=
    nullif(payload ->> 'actor_profile_id', '')::uuid;
  amount_cents bigint :=
    coalesce(
      nullif(payload ->> 'amount_cents', '')::bigint,
      0
    );
  currency text :=
    coalesce(
      nullif(payload ->> 'currency', ''),
      'USD'
    );
  source_value text :=
    coalesce(
      nullif(payload ->> 'source', ''),
      'wallet'
    );
  reason_value text :=
    nullif(payload ->> 'reason', '');
  actor_role text;
  company_name text;
  amount_label text;
begin
  if amount_cents <= 0
     or company_id is null then
    return new;
  end if;

  if actor_id is not null then
    select role.name
    into actor_role
    from public.profiles as profile
    join public.roles as role
      on role.id = profile.role_id
    where profile.id = actor_id;
  end if;

  select company.name
  into company_name
  from public.companies as company
  where company.id = company_id;

  amount_label :=
    currency ||
    ' ' ||
    to_char(
      amount_cents::numeric / 100,
      'FM999999999999990.00'
    );

  perform private.emit_internal_notification(
    'wallet-credit-internal:' || new.id::text,
    'wallet',
    'credit',
    case
      when actor_role = 'client'
        then 'Client recharged wallet'
      else 'Client wallet credited'
    end,
    coalesce(company_name, 'Client') ||
      ' received ' ||
      amount_label ||
      case
        when reason_value is null then '.'
        else '. ' || reason_value
      end,
    '/clients/' || company_id::text,
    'company',
    company_id,
    actor_id,
    company_id,
    now()
  );

  perform private.emit_company_client_notification(
    company_id,
    'wallet-credit-client:' || new.id::text,
    'wallet',
    'credit',
    amount_label || ' added to your wallet',
    case
      when actor_role = 'client'
        then 'Your wallet recharge was recorded.'
      else 'Wolf Forge added funds to your account.'
    end,
    '/account',
    'company',
    company_id,
    actor_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_wallet_credit
  on public.company_wallet_transactions;

create trigger notifications_wallet_credit
after insert on public.company_wallet_transactions
for each row
execute function private.notify_wallet_credit();


-- ------------------------------------------------------------
-- Preserve the current wallet-history experience without making
-- old rows unread. Only the newest 20 are backfilled, internal only.
-- ------------------------------------------------------------

with recent_wallet as (
  select
    transaction.id,
    transaction.company_id,
    transaction.actor_profile_id,
    transaction.amount_cents,
    transaction.currency,
    transaction.reason,
    transaction.created_at,
    company.name as company_name
  from public.company_wallet_transactions as transaction
  left join public.companies as company
    on company.id = transaction.company_id
  order by transaction.created_at desc
  limit 20
)
insert into public.notifications (
  recipient_profile_id,
  company_id,
  audience,
  category,
  variant,
  title,
  body,
  href,
  entity_type,
  entity_id,
  actor_profile_id,
  event_key,
  read_at,
  created_at
)
select
  profile.id,
  wallet.company_id,
  'internal',
  'wallet',
  case
    when wallet.amount_cents >= 0 then 'credit'
    else 'debit'
  end,
  case
    when wallet.amount_cents >= 0
      then 'Client wallet credited'
    else 'Client wallet debited'
  end,
  coalesce(wallet.company_name, 'Client') ||
    ' wallet changed by ' ||
    wallet.currency ||
    ' ' ||
    to_char(
      abs(wallet.amount_cents)::numeric / 100,
      'FM999999999999990.00'
    ) ||
    '.',
  '/clients/' || wallet.company_id::text,
  'company',
  wallet.company_id,
  wallet.actor_profile_id,
  'legacy-wallet:' || wallet.id::text,
  now(),
  wallet.created_at
from recent_wallet as wallet
cross join public.profiles as profile
join public.roles as role
  on role.id = profile.role_id
where role.name in ('owner', 'admin', 'manager', 'staff')
  and profile.archived_at is null
on conflict (recipient_profile_id, event_key) do nothing;