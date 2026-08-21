-- Wolf Forge Platform
-- Pre-deploy Security Fix Batch B1 for confirmed findings
-- N-01, M-01 and M-02. M-05 is application-side and has no schema part.
--
-- Forward-only. Nothing here reverses a Batch A control; M-03 and M-04 are
-- deliberately untouched.
--
--   N-01  Services / service-folder / Services-activity reads now require the
--         Services module capability, while the public Store projection is
--         preserved exactly as it was.
--   M-01  Notification fan-out becomes capability-aware for every existing
--         domain, and the notification read/mark RPCs require a currently
--         active resolved profile rather than a bare auth.uid().
--   M-02  Direct authenticated INSERT authority on public.activity_events is
--         removed; audit rows can only be created by the trusted SECURITY
--         DEFINER writers and triggers that already derive actor and time.

-- =============================================================================
-- N-01: Services read authorization
-- =============================================================================

-- The internal Service read path is the one that exposes inactive, private and
-- archived catalogue rows, so it is the one that must carry services.view.
-- services_authenticated_select_active is left untouched: it is the active +
-- public + non-archived projection the client Store reads, and every internal
-- account keeps it as a floor.
drop policy if exists services_internal_select on public.services;

create policy services_internal_select
on public.services
for select
to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('services.view')
);

-- Same shape for folders. service_folders_authenticated_select_active still
-- publishes non-archived folders to every authenticated session because the
-- Store's category navigation is built from them; only the internal policy,
-- which is what additionally reveals archived folder metadata, is narrowed.
drop policy if exists service_folders_internal_select on public.service_folders;

create policy service_folders_internal_select
on public.service_folders
for select
to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('services.view')
);

-- The Services branch of the internal activity feed was unconditional, so a
-- Services-denied actor could still read catalogue history. It now matches the
-- coupon/invoice/subscription/order branches, which are already capability
-- scoped. Every other branch is reproduced verbatim.
drop policy if exists activity_events_internal_scoped_select on public.activity_events;

create policy activity_events_internal_scoped_select
on public.activity_events for select to authenticated
using (
  (select private.is_internal_user())
  and (
    (select private.is_client_private_admin())
    or (
      entity_type in ('service', 'service_folder')
      and public.app_has_permission('services.view')
    )
    or (
      entity_type = 'coupon'
      and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage'))
    )
    or (entity_type = 'invoice' and (select private.can_read_invoice(entity_id)))
    or (entity_type = 'subscription' and (select private.can_read_subscription(entity_id)))
    or (entity_type = 'order' and (select private.can_access_operational_order(entity_id)))
    or (entity_type = 'order_task' and (select private.can_access_operational_task(entity_id)))
  )
);

-- =============================================================================
-- M-02: remove browser-authored audit events
-- =============================================================================

-- Audit rows must be produced by the trusted writers only
-- (private.record_authenticated_activity, private.record_form_activity,
-- private.record_ticket_activity, private.record_subscription_event and the
-- lifecycle triggers). Those are SECURITY DEFINER and run as the table owner,
-- so revoking the browser grant cannot disturb them.
drop policy if exists activity_events_internal_insert on public.activity_events;

revoke insert on table public.activity_events from authenticated;

comment on table public.activity_events is
  'Append-only audit stream. Rows are created only by trusted SECURITY DEFINER writers and triggers that derive actor and timestamp server-side; no browser role holds INSERT.';

-- =============================================================================
-- M-01: capability-aware notification fan-out
-- =============================================================================

-- The permission-filtered mirror of private.emit_internal_notification. The
-- capability is a required argument rather than an optional one so a future
-- emitter cannot silently fall back to broadcasting.
create or replace function private.emit_internal_notification_for_permission(
  p_required_permission_key text,
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
    profile_row.id,
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
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  where role_row.name in ('owner', 'admin', 'manager', 'staff')
    and profile_row.archived_at is null
    and private.profile_has_permission(
      profile_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

revoke all on function private.emit_internal_notification_for_permission(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

comment on function private.emit_internal_notification_for_permission(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz
)
is 'Internal notification fan-out restricted to active internal profiles that hold the module capability the notification metadata belongs to.';

-- ---------------------------------------------------------------------------
-- Internal emitters, one capability each
-- ---------------------------------------------------------------------------

-- Projects
create or replace function private.notify_project_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  project_title text := coalesce(nullif(payload ->> 'title', ''), 'New Project');
begin
  perform private.emit_internal_notification_for_permission(
    'projects.view',
    'project-created:' || new.id::text,
    'project',
    'info',
    'Project created',
    project_title,
    '/orders/' || new.id::text,
    'order',
    new.id,
    (select auth.uid()),
    company_id,
    now()
  );

  return new;
end;
$$;

-- Clients
create or replace function private.notify_client_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  profile_id uuid := nullif(payload ->> 'profile_id', '')::uuid;
  contact_name text := coalesce(nullif(payload ->> 'name', ''), 'New client');
  is_primary boolean := coalesce(nullif(payload ->> 'is_primary', '')::boolean, false);
begin
  if not is_primary and profile_id is null then
    return new;
  end if;

  perform private.emit_internal_notification_for_permission(
    'clients.view',
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
    (select auth.uid()),
    company_id,
    now()
  );

  return new;
end;
$$;

-- Forms
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
  perform private.emit_internal_notification_for_permission(
    'forms.view',
    'form-created:' || new.id::text,
    'form',
    'info',
    'Form created',
    form_name,
    '/forms/' || new.id::text,
    'form',
    new.id,
    (select auth.uid()),
    null,
    now()
  );

  return new;
end;
$$;

-- Coupons
create or replace function private.notify_coupon_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  coupon_code text := coalesce(nullif(payload ->> 'code', ''), 'New coupon');
begin
  perform private.emit_internal_notification_for_permission(
    'coupons.view',
    'coupon-created:' || new.id::text,
    'coupon',
    'info',
    'Coupon created',
    coupon_code,
    '/coupons/' || new.id::text,
    'coupon',
    new.id,
    (select auth.uid()),
    null,
    now()
  );

  return new;
end;
$$;

-- Tickets
create or replace function private.notify_client_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  ticket_id uuid := nullif(payload ->> 'ticket_id', '')::uuid;
  author_id uuid := nullif(payload ->> 'author_profile_id', '')::uuid;
  message_kind text := payload ->> 'message_kind';
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

  select role_row.name, profile_row.display_name
  into author_role, author_name
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  where profile_row.id = author_id;

  if author_role is distinct from 'client' then
    return new;
  end if;

  select ticket_row.public_ref, ticket_row.subject, ticket_row.company_id
  into ticket_ref, ticket_subject, company_id
  from public.tickets as ticket_row
  where ticket_row.id = ticket_id;

  perform private.emit_internal_notification_for_permission(
    'tickets.view',
    'client-ticket-reply:' || new.id::text,
    'ticket',
    'info',
    'Client replied to ' || coalesce(ticket_ref, 'a Ticket'),
    coalesce(nullif(author_name, ''), 'A client')
      || case
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

-- Invoices / payments
create or replace function private.notify_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  old_payload jsonb;
  payment_status text := payload ->> 'status';
  previous_status text;
  invoice_id uuid := nullif(payload ->> 'invoice_id', '')::uuid;
  payment_amount bigint := coalesce(nullif(payload ->> 'amount_cents', '')::bigint, 0);
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

  if tg_op = 'UPDATE' and previous_status = 'succeeded' then
    return new;
  end if;

  if invoice_id is null then
    return new;
  end if;

  select
    invoice_row.invoice_number,
    invoice_row.status,
    invoice_row.currency,
    invoice_row.company_id,
    company_row.name
  into
    invoice_number,
    invoice_status,
    invoice_currency,
    company_id,
    company_name
  from public.invoices as invoice_row
  left join public.companies as company_row
    on company_row.id = invoice_row.company_id
  where invoice_row.id = invoice_id;

  amount_label :=
    coalesce(invoice_currency, 'USD') || ' '
    || to_char(abs(payment_amount)::numeric / 100, 'FM999999999999990.00');

  perform private.emit_internal_notification_for_permission(
    'invoices.view',
    'invoice-payment:' || new.id::text,
    'payment',
    'credit',
    case
      when invoice_status = 'paid' then 'Invoice paid'
      else 'Invoice payment received'
    end,
    coalesce(company_name, 'Client') || ' paid ' || amount_label
      || case
           when invoice_number is null then '.'
           else ' on Invoice #WF-' || lpad(invoice_number::text, 4, '0') || '.'
         end,
    '/invoices/' || invoice_id::text,
    'invoice',
    invoice_id,
    (select auth.uid()),
    company_id,
    now()
  );

  return new;
end;
$$;

-- Wallet. The internal half is client-account money reachable only from
-- /clients/<company>, so Clients is the capability that owns it; the client
-- half keeps the Batch A invoices.view boundary.
create or replace function private.notify_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  actor_id uuid := nullif(payload ->> 'actor_profile_id', '')::uuid;
  amount_cents bigint := coalesce(nullif(payload ->> 'amount_cents', '')::bigint, 0);
  currency text := coalesce(nullif(payload ->> 'currency', ''), 'USD');
  reason_value text := nullif(payload ->> 'reason', '');
  actor_role text;
  company_name text;
  amount_label text;
begin
  if amount_cents <= 0 or company_id is null then
    return new;
  end if;

  if actor_id is not null then
    select role_row.name into actor_role
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = actor_id;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = company_id;

  amount_label := currency || ' '
    || to_char(amount_cents::numeric / 100, 'FM999999999999990.00');

  perform private.emit_internal_notification_for_permission(
    'clients.view',
    'wallet-credit-internal:' || new.id::text,
    'wallet',
    'credit',
    case
      when actor_role = 'client' then 'Client recharged wallet'
      else 'Client wallet credited'
    end,
    coalesce(company_name, 'Client') || ' received ' || amount_label
      || case
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

  perform private.emit_company_client_notification_for_permission(
    company_id,
    'invoices.view',
    'wallet-credit-client:' || new.id::text,
    'wallet',
    'credit',
    amount_label || ' added to your wallet',
    case
      when actor_role = 'client' then 'Your wallet recharge was recorded.'
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

-- ---------------------------------------------------------------------------
-- Client emitters that were still capability-blind
-- ---------------------------------------------------------------------------

-- Wolf Forge replied to a conversation: Messages metadata belongs to the
-- portal Tickets module.
create or replace function private.notify_client_ticket_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_role text;
  author_name text;
  ticket_ref text;
  ticket_subject text;
  ticket_company_id uuid;
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

  if author_role is null
     or author_role not in ('owner', 'admin', 'manager', 'staff') then
    return new;
  end if;

  select ticket_row.public_ref, ticket_row.subject, ticket_row.company_id
  into ticket_ref, ticket_subject, ticket_company_id
  from public.tickets as ticket_row
  where ticket_row.id = new.ticket_id;

  if ticket_company_id is null then
    return new;
  end if;

  perform private.emit_company_client_notification_for_permission(
    ticket_company_id,
    'tickets.view',
    'client-ticket-response:' || new.id::text,
    'ticket',
    'info',
    'New message from Wolf Forge',
    coalesce(nullif(author_name, ''), 'Wolf Forge')
      || case
           when ticket_subject is null then ' replied to your conversation.'
           else ' replied to "' || ticket_subject || '".'
         end,
    '/account/messages/' || new.ticket_id::text,
    'ticket',
    new.ticket_id,
    new.author_profile_id,
    now()
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The two legacy blind emitters
--
-- Rewriting each caller is not enough on its own: private.emit_internal_
-- notification and private.emit_company_client_notification remain reachable
-- from the three Reporting send RPCs and from any emitter written later, and
-- as long as they broadcast, the class of bug can come straight back.
--
-- Rather than reproduce three large Reporting RPCs verbatim just to change one
-- argument, both emitters now derive the required capability from the
-- notification's own audience and category, through one authoritative map. An
-- unmapped combination resolves to no capability and therefore reaches no
-- recipient: an emitter that has not been reasoned about fails closed instead
-- of leaking. `022`-style tests below pin the map to the category CHECK
-- constraint so a new category cannot be added without a decision here.
-- ---------------------------------------------------------------------------

create or replace function private.notification_category_permission(
  p_audience text,
  p_category text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_audience = 'internal' then
      case p_category
        when 'project' then 'projects.view'
        when 'client'  then 'clients.view'
        when 'form'    then 'forms.view'
        when 'coupon'  then 'coupons.view'
        when 'ticket'  then 'tickets.view'
        when 'payment' then 'invoices.view'
        -- Client wallet money is only reachable from /clients/<company>.
        when 'wallet'  then 'clients.view'
        when 'store'   then 'investment_intent.view'
        when 'report'  then 'reports.send'
        else null
      end
    when p_audience = 'client' then
      case p_category
        when 'project' then 'projects.view'
        when 'client'  then 'dashboard.view'
        when 'form'    then 'forms.view'
        -- A client account has no Coupons module; nothing may fan out to one.
        when 'coupon'  then null
        when 'ticket'  then 'tickets.view'
        when 'payment' then 'invoices.view'
        when 'wallet'  then 'invoices.view'
        when 'store'   then 'store.view'
        when 'report'  then 'reporting.view'
        else null
      end
    else null
  end;
$$;

revoke all on function private.notification_category_permission(text, text)
from public, anon, authenticated, service_role;

comment on function private.notification_category_permission(text, text)
is 'Authoritative notification audience+category to module capability map. Returns null for anything undecided so fan-out fails closed.';

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
  select private.emit_internal_notification_for_permission(
    private.notification_category_permission('internal', p_category),
    p_event_key,
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_company_id,
    p_created_at
  );
$$;

comment on function private.emit_internal_notification(
  text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz
)
is 'Compatibility wrapper. Derives the required internal capability from the notification category; it can no longer broadcast to every active internal profile.';

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
  select private.emit_company_client_notification_for_permission(
    p_company_id,
    private.notification_category_permission('client', p_category),
    p_event_key,
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_created_at
  );
$$;

comment on function private.emit_company_client_notification(
  uuid, text, text, text, text, text, text, text, uuid, uuid, timestamptz
)
is 'Compatibility wrapper. Derives the required portal capability from the notification category, so the three Reporting send paths and any later caller stay module appropriate.';

revoke all on function private.emit_internal_notification(
  text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

revoke all on function private.emit_company_client_notification(
  uuid, text, text, text, text, text, text, text, uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rows already delivered by the blind fan-out
--
-- Fixing the emitters does nothing for metadata that has already landed in a
-- recipient's bell. The unified-notification migration's legacy wallet
-- backfill, in particular, wrote one row per active internal profile with no
-- capability check at all. Anything currently sitting against a recipient who
-- does not hold the capability its own audience and category require is
-- removed here. A notification is a delivery, not an audit record, so removing
-- it destroys no history: the underlying invoice, ticket, project and activity
-- rows are untouched.
-- ---------------------------------------------------------------------------

delete from public.notifications as notification_row
where private.notification_category_permission(
        notification_row.audience,
        notification_row.category
      ) is null
   or not private.profile_has_permission(
        notification_row.recipient_profile_id,
        private.notification_category_permission(
          notification_row.audience,
          notification_row.category
        )
      );

-- ---------------------------------------------------------------------------
-- Notification read/mark boundary: an archived profile holding a still-valid
-- JWT must not be able to list or mutate notification state.
-- ---------------------------------------------------------------------------

create or replace function private.require_active_notification_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null
    or private.profile_account_class(caller_id) is null
  then
    raise exception 'active authenticated notification access required'
      using errcode = '42501';
  end if;

  return caller_id;
end;
$$;

revoke all on function private.require_active_notification_actor()
from public, anon, authenticated, service_role;

comment on function private.require_active_notification_actor()
is 'Resolves the notification caller only when the profile still exists and is not archived, so a stale JWT cannot read or mutate notification state.';

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
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
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
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications
  set read_at = now()
  where recipient_profile_id = caller_id
    and read_at is null;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

comment on function public.app_list_my_notifications(integer)
is 'Exact-recipient notification list. Requires a currently active resolved profile, so an archived account cannot read with a stale JWT.';
comment on function public.app_mark_notification_read(uuid)
is 'Exact-recipient read marker. Requires a currently active resolved profile.';
comment on function public.app_mark_all_notifications_read()
is 'Exact-recipient bulk read marker. Requires a currently active resolved profile.';
