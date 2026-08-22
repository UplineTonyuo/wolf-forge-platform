-- Wolf Forge Platform — Store service purchase → paid order → fulfillment Ticket
--
-- The first real purchase/fulfillment workflow. A client spends their Wolf Forge
-- Balance on a catalogue Service and, in ONE transaction, the platform issues an
-- invoice, settles it from the wallet, provisions the fulfillment Order, opens
-- the fulfillment Ticket and tells the Wolf Forge team.
--
-- Nothing here invents a second money ledger. The accounting shape was already
-- designed for exactly this and left unfinished: public.invoice_items carries
-- service_id, order_id and a fulfillment_status of
-- awaiting_payment → pending → provisioned, and its own CHECK requires order_id
-- to be present precisely when the line is 'provisioned'. The shipped comment on
-- that column reads "Order provisioning remains deferred until a reusable
-- fulfillment boundary exists." This migration is that boundary.
--
-- THE GOLDEN RULE is enforced structurally rather than by convention: every step
-- below runs inside one PL/pgSQL function, therefore one transaction. A failure
-- anywhere — insufficient balance, inactive service, Order insert, Ticket
-- insert, notification fan-out — rolls back the wallet debit, the payment and
-- the invoice with it. There is no reachable state in which fulfillment exists
-- without a successful payment, and none in which money moved without
-- fulfillment.
--
-- Scope, deliberately: ONE-TIME services settled from the Wolf Forge Balance.
-- Recurring catalogue entries are refused here because a recurring purchase is a
-- subscription, and public.subscriptions is a separate module with its own
-- lifecycle. No external rail is touched: Stripe, PayPal and bank transfer
-- remain unconnected and unreachable (KI-010, KI-012).

-- =============================================================================
-- 1. Durable purchase → fulfillment linkage
--
-- The question the database must be able to answer is "which Ticket belongs to
-- this purchased Order", and its inverse "has a fulfillment Ticket already been
-- created for this purchase". A foreign key answers both, and the partial unique
-- index makes a second fulfillment Ticket for one Order unrepresentable rather
-- than merely unlikely.
-- =============================================================================

alter table public.tickets
  add column if not exists order_id uuid
    references public.orders (id) on delete restrict;

comment on column public.tickets.order_id is
  'The fulfillment Order this Ticket tracks. Set by app_purchase_service_with_balance; null for ordinary conversations. Unique among non-null values so one purchased Order can never carry two fulfillment Tickets.';

create unique index if not exists tickets_order_fulfillment_unique
  on public.tickets (order_id)
  where order_id is not null;

-- =============================================================================
-- 2. A purchase is a real billing reason
--
-- invoices.billing_reason already distinguishes manual invoicing from the four
-- subscription paths. A Store purchase is a fifth, and naming it is what lets a
-- later reader tell a purchased invoice from one William typed by hand without
-- inspecting its line items.
-- =============================================================================

alter table public.invoices
  drop constraint invoices_billing_reason_valid;

alter table public.invoices
  add constraint invoices_billing_reason_valid check (
    billing_reason is null or billing_reason in (
      'manual', 'subscription_create', 'subscription_cycle',
      'subscription_update', 'subscription_threshold', 'store_purchase'
    )
  );

-- =============================================================================
-- 3. Internal WF Card membership activation
--
-- Ordinary invoice settlement is gated on an active wf_card_memberships row in
-- app_pay_invoice_with_wallet, and for a long time NO code path anywhere wrote
-- that table (KI-013) — a membership could only be created by direct database
-- access. Store purchasing no longer requires a membership (it is now available
-- to every funded client), but the invoice rail still does, so the entitlement
-- still needs a legitimate writer.
--
-- This is the smallest thing that closes it: an audited internal RPC behind the
-- existing money capability. It does NOT sell the membership to a client; that
-- remains future work. It lets Wolf Forge grant the entitlement it already
-- decided to grant, which is exactly what was happening by hand.
-- =============================================================================

create or replace function public.app_set_wf_card_membership(
  p_request_id uuid,
  p_company_id uuid,
  p_active boolean
)
returns public.wf_card_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  offer_row public.wf_card_settings;
  membership_row public.wf_card_memberships;
  request_payload jsonb := jsonb_build_object(
    'company_id', p_company_id,
    'active', p_active
  );
  existing_id uuid;
begin
  if p_request_id is null or p_company_id is null or p_active is null then
    raise exception 'invalid WF Card membership request' using errcode = '22023';
  end if;

  -- Membership is an entitlement against money, so it rides the capability that
  -- already governs money rather than inventing a parallel permission.
  perform private.require_permission('invoices.manage');

  if not exists (
    select 1 from public.companies as company_row
    where company_row.id = p_company_id
      and company_row.archived_at is null
  ) then
    raise exception 'active company is required' using errcode = '23503';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'wf_card.membership.set', p_request_id, request_payload
  );
  if existing_id is not null then
    select membership.* into membership_row
    from public.wf_card_memberships as membership
    where membership.company_id = existing_id;
    if membership_row.company_id is null then raise no_data_found; end if;
    return membership_row;
  end if;

  select settings.* into offer_row
  from public.wf_card_settings as settings
  where settings.singleton;

  if offer_row.membership_price_cents is null then raise no_data_found; end if;

  insert into public.wf_card_memberships (
    company_id, status, activated_at, deactivated_at,
    purchase_price_cents, purchase_currency, purchase_reference
  ) values (
    p_company_id,
    case when p_active then 'active' else 'inactive' end,
    case when p_active then now() else null end,
    null,
    offer_row.membership_price_cents,
    offer_row.membership_currency,
    'wolf-forge-internal'
  )
  on conflict (company_id) do update
  set status = case when p_active then 'active' else 'cancelled' end,
      activated_at = case
        when p_active then coalesce(public.wf_card_memberships.activated_at, now())
        else public.wf_card_memberships.activated_at
      end,
      deactivated_at = case when p_active then null else now() end
  returning * into membership_row;

  perform private.record_authenticated_activity(
    'company',
    p_company_id,
    case when p_active then 'company.wf_card_activated' else 'company.wf_card_deactivated' end,
    case
      when p_active then 'Activated the WF Card membership.'
      else 'Deactivated the WF Card membership.'
    end,
    jsonb_build_object('company_id', p_company_id, 'status', membership_row.status)
  );

  perform private.remember_create_request(
    actor_id, 'wf_card.membership.set', p_request_id, request_payload, p_company_id
  );

  return membership_row;
end;
$$;

revoke all on function public.app_set_wf_card_membership(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.app_set_wf_card_membership(uuid, uuid, boolean)
  to authenticated;

comment on function public.app_set_wf_card_membership(uuid, uuid, boolean) is
  'Internal, audited WF Card membership activation behind invoices.manage. Retry-safe on request id. Does not take payment: it grants an entitlement Wolf Forge decided to grant. Client self-service membership purchase remains future work.';

-- =============================================================================
-- 4. The internal emitter learns to skip one profile
--
-- The notification audit found that emit_internal_notification_for_permission
-- reaches every capable internal profile INCLUDING the actor who caused the
-- event, so a staff member who creates something notifies themselves. The new
-- Ticket-created event must not do that when an internal account opens a Ticket
-- on a client's behalf.
--
-- The parameter is added with a null default and the old signature is dropped so
-- no overload can become ambiguous. Every existing caller passes twelve
-- positional arguments and therefore binds to the new function with
-- p_exclude_profile_id = null, which selects exactly the rows it selected
-- before. No existing event changes behaviour; 037 pins that.
-- =============================================================================

drop function if exists private.emit_internal_notification_for_permission(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz
);

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
  p_created_at timestamptz,
  p_exclude_profile_id uuid default null
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
    and (p_exclude_profile_id is null or profile_row.id <> p_exclude_profile_id)
    and private.profile_has_permission(
      profile_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

revoke all on function private.emit_internal_notification_for_permission(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz, uuid
)
from public, anon, authenticated, service_role;

comment on function private.emit_internal_notification_for_permission(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz, uuid
)
is 'Internal notification fan-out restricted to active internal profiles that hold the module capability the notification metadata belongs to. p_exclude_profile_id optionally drops the actor so a staff member does not notify themselves; null (the default, and what every pre-existing caller passes) preserves the original recipient set exactly.';

-- =============================================================================
-- 5. TICKET_CREATED — the canonical Ticket-created notification
--
-- Closes the P0 gap the audit confirmed: both existing Ticket triggers require
-- message_kind = 'reply', and app_create_ticket writes the opening message as
-- 'initial_request', so a client could open a conversation and no staff member
-- was ever told.
--
-- This is ONE event with two faces, not two systems. A purchase Ticket carries
-- order_id and reads as a purchase; every other Ticket reads as a new
-- conversation. Both use audience 'internal', category 'ticket', the mapped
-- tickets.view capability and the deterministic key 'ticket-created:<id>'.
-- =============================================================================

create or replace function private.notify_ticket_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_name text;
  service_name text;
  notification_title text;
  notification_body text;
begin
  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = new.company_id;

  if new.order_id is not null then
    -- A fulfillment Ticket. The service is the point, so it leads the copy.
    select service_row.name into service_name
    from public.orders as order_row
    join public.services as service_row
      on service_row.id = order_row.service_id
    where order_row.id = new.order_id;

    notification_title := 'New service purchase';
    notification_body :=
      coalesce(nullif(company_name, ''), 'A client')
      || ' purchased '
      || coalesce(nullif(service_name, ''), 'a Wolf Forge service')
      || '.';
  else
    notification_title :=
      'New ticket from '
      || coalesce(
           nullif(company_name, ''),
           nullif(new.requester_name, ''),
           'a visitor'
         );
    notification_body :=
      coalesce(new.public_ref || ' · ', '') || new.subject;
  end if;

  perform private.emit_internal_notification_for_permission(
    'tickets.view',
    'ticket-created:' || new.id::text,
    'ticket',
    'info',
    notification_title,
    notification_body,
    '/tickets/' || new.id::text,
    'ticket',
    new.id,
    new.created_by_profile_id,
    new.company_id,
    now(),
    -- An internal account opening a Ticket on a client's behalf already knows.
    -- A client-created or system-created Ticket excludes nobody.
    (select auth.uid())
  );

  return new;
end;
$$;

revoke all on function private.notify_ticket_created()
  from public, anon, authenticated, service_role;

drop trigger if exists notifications_ticket_created on public.tickets;

create trigger notifications_ticket_created
after insert on public.tickets
for each row
execute function private.notify_ticket_created();

comment on function private.notify_ticket_created() is
  'Internal notification when any Ticket is opened. A Ticket carrying order_id reads as a service purchase; every other Ticket reads as a new conversation. Excludes the acting profile so internal staff do not notify themselves.';

-- =============================================================================
-- 6. One purchase must produce ONE notification
--
-- public.orders already carries notifications_project_created, which would give
-- every purchase a second, thinner row ("Project created") pointing at
-- /orders/<id> for the same event the richer purchase notification already
-- describes. The purchase RPC marks its own Order insert with a
-- transaction-local flag — the same idiom app_pay_invoice_with_wallet uses for
-- app.wf_wallet_invoice_payment_id — and the project trigger stands down for it.
--
-- Ordinary internal project creation is untouched: the flag is never set on that
-- path, so the guard is false and the notification fires exactly as before.
-- =============================================================================

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
  company_name text;
begin
  -- A Store purchase announces itself through its fulfillment Ticket, which
  -- carries the client, the service and the money. A second generic row for the
  -- same event would be noise.
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
$$;

revoke all on function private.notify_project_created()
  from public, anon, authenticated, service_role;

comment on function private.notify_project_created() is
  'Internal notification when a project is created, naming the company and order number. Stands down for Store purchases, which announce themselves through their fulfillment Ticket.';

-- ---------------------------------------------------------------------------
-- The same stand-down for the client invoice notification.
--
-- notifications_client_invoice_issued fires on the draft → unpaid transition and
-- tells the client "Invoice #WF-xxxx is due <date>". For a Store purchase that
-- sentence is false by the time the transaction commits: the invoice is settled
-- microseconds later and is PAID, not due. The client also just watched the
-- purchase succeed on screen, so the row would be both wrong and redundant.
--
-- Ordinary invoicing is untouched. William issuing an invoice by hand never sets
-- the flag, so the guard is false and the client is notified exactly as before.
-- ---------------------------------------------------------------------------

create or replace function private.notify_client_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  amount_label text;
begin
  if new.status is distinct from 'unpaid'
    or old.status is not distinct from 'unpaid'
  then
    return new;
  end if;

  if coalesce(
       nullif(current_setting('app.wf_store_purchase_order', true), ''),
       ''
     ) = 'on'
  then
    return new;
  end if;

  amount_label := new.currency || ' '
    || to_char(new.total_cents / 100.0, 'FM999999990.00');

  perform private.emit_company_client_notification_for_permission(
    new.company_id,
    'invoices.view',
    'client-invoice-issued:' || new.id::text,
    'payment',
    'debit',
    case
      when new.invoice_number is null then 'New invoice'
      else 'Invoice #WF-' || lpad(new.invoice_number::text, 4, '0')
    end,
    amount_label
      || case
           when new.due_at is null then ' is ready to view.'
           else ' is due ' || to_char(new.due_at, 'FMMon FMDD') || '.'
         end,
    '/account/invoices/' || new.id::text,
    'invoice',
    new.id,
    (select auth.uid()),
    now()
  );

  return new;
end;
$$;

revoke all on function private.notify_client_invoice_issued()
  from public, anon, authenticated, service_role;

comment on function private.notify_client_invoice_issued() is
  'Client notification on the draft -> unpaid transition, i.e. when an invoice is actually issued. Stands down inside a Store purchase, where the invoice is paid in the same transaction and a "due" notification would be untrue.';

-- =============================================================================
-- 6b. A paid purchase may provision exactly its own Order
--
-- public.orders refuses client-initiated projects, and that rule stays. A client
-- session still holds no projects.create capability and still cannot create a
-- project by asking. What this adds is the narrowest possible allowance, modelled
-- exactly on the one private.enforce_company_wallet_permission already opens for
-- the wallet debit: an INSERT is permitted only while the transaction names a
-- succeeded Wolf Forge Balance payment that the caller made, against a paid
-- store_purchase invoice belonging to the caller's own company, for the very
-- Service the Order provisions.
--
-- The trigger re-derives every one of those facts itself. It trusts the setting
-- for nothing except which payment to go and check, so the purchase RPC cannot
-- widen its own permission, and setting the variable by hand grants nothing
-- without a real settled payment behind it.
-- =============================================================================

create or replace function private.enforce_order_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_payment_id uuid;
begin
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
        join public.profiles as profile_row
          on profile_row.id = (select auth.uid())
         and profile_row.company_id = invoice_row.company_id
         and profile_row.archived_at is null
        join public.roles as role_row
          on role_row.id = profile_row.role_id
         and role_row.name = 'client'
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
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
$$;

revoke all on function private.enforce_order_permission()
  from public, anon, authenticated, service_role;

comment on function private.enforce_order_permission() is
  'Project write authorization. Client-initiated projects remain refused; the single exception is an Order provisioned by a settled Store purchase, which the trigger verifies independently against the payment, the paid store_purchase invoice, its line item and the caller''s own company. No WF Card membership is required for this exception — a Store purchase must not depend on one.';

-- =============================================================================
-- 6c. The wallet debit keeps its membership gate — except for a Store purchase
--
-- private.enforce_company_wallet_permission is the shared narrow allowance that
-- lets a transaction debit a company wallet. It is keyed on
-- app.wf_wallet_invoice_payment_id, which both app_pay_invoice_with_wallet and
-- app_purchase_service_with_balance set before their UPDATE. Originally the
-- UPDATE branch required an active WF Card membership, exactly as the invoice
-- RPC does. That membership predicate is now waived when the payment belongs to
-- an invoice whose billing_reason is 'store_purchase' — the discriminator is the
-- invoice's own server-set reason, not a client-settable flag. Ordinary invoice
-- settlement keeps the membership gate unchanged, so app_pay_invoice_with_wallet
-- is byte-identical in behaviour.
--
-- Every other re-derived fact is untouched: the payment must be a real,
-- succeeded, wolf_forge_wallet payment the caller created, for their own
-- company, and the debit must equal that payment's amount exactly and never go
-- negative. Naming a payment id by hand grants nothing, and there is no
-- standing wolf_forge_wallet payment on a store_purchase invoice that the
-- purchase RPC has not already settled in the same transaction.
-- =============================================================================

create or replace function private.enforce_company_wallet_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_payment_id uuid;
begin
  if tg_table_name = 'company_wallets' then
    if tg_op = 'INSERT' and new.balance_cents = 0 then
      return new;
    end if;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;

  begin
    context_payment_id := nullif(
      current_setting('app.wf_wallet_invoice_payment_id', true), ''
    )::uuid;
  exception when invalid_text_representation then
    context_payment_id := null;
  end;

  if context_payment_id is not null then
    if tg_table_name = 'company_wallets' then
      if tg_op = 'UPDATE' and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row on invoice_row.id = payment_row.invoice_id
        join public.profiles as profile_row
          on profile_row.id = (select auth.uid())
         and profile_row.company_id = invoice_row.company_id
         and profile_row.archived_at is null
        join public.roles as role_row on role_row.id = profile_row.role_id and role_row.name = 'client'
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and old.company_id = invoice_row.company_id
          and new.company_id = old.company_id
          and new.currency = old.currency
          and old.balance_cents - new.balance_cents = payment_row.amount_cents
          and new.balance_cents >= 0
          and (
            -- A Store purchase settles an invoice whose billing_reason is set
            -- to 'store_purchase' inside app_purchase_service_with_balance, so
            -- that debit needs no membership. Any other invoice keeps the
            -- membership gate, matching app_pay_invoice_with_wallet.
            invoice_row.billing_reason = 'store_purchase'
            or exists (
              select 1
              from public.wf_card_memberships as membership_row
              where membership_row.company_id = invoice_row.company_id
                and membership_row.status = 'active'
            )
          )
      ) then
        return new;
      end if;
    end if;

    if tg_table_name = 'company_wallet_transactions' then
      if tg_op = 'INSERT' and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row on invoice_row.id = payment_row.invoice_id
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and new.actor_profile_id = (select auth.uid())
          and new.company_id = invoice_row.company_id
          and new.invoice_id = invoice_row.id
          and new.invoice_payment_id = payment_row.id
          and new.request_id = payment_row.request_id
          and new.amount_cents = -payment_row.amount_cents
          and new.currency = payment_row.currency
          and new.source = 'invoice_payment'
      ) then
        return new;
      end if;
    end if;
  end if;

  perform private.require_permission('client_private.manage');
  return new;
end;
$$;

revoke all on function private.enforce_company_wallet_permission()
  from public, anon, authenticated, service_role;

comment on function private.enforce_company_wallet_permission() is
  'Wallet write authorization. A browser role may not touch a wallet; the one exception is a transaction that names a succeeded wolf_forge_wallet payment it created, for its own company, debiting exactly that payment''s amount. Active WF Card membership is still required unless the payment settles a store_purchase invoice, which is the purchase RPC''s own rail.';

-- =============================================================================
-- 7. The purchase boundary
--
-- One function, one transaction, one purchase.
--
-- Everything the money depends on is re-resolved here from stable identifiers:
-- the company from auth.uid(), the price and the active/public state from
-- public.services, the balance from public.company_wallets under FOR UPDATE. The
-- browser sends a service id and a request id and nothing else that matters — a
-- crafted price, company or title has nowhere to enter.
-- =============================================================================

create or replace function public.app_purchase_service_with_balance(
  p_request_id uuid,
  p_service_id uuid
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
  ticket_row public.tickets;
  company_name text;
  price_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_service_id is null then
    raise exception 'WF_PURCHASE_INVALID_REQUEST' using errcode = '22023';
  end if;

  -- Company identity is derived, never accepted. There is no parameter through
  -- which another company could be named.
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

  -- Reauthorize before the idempotency lookup, so a purchase made while access
  -- was granted cannot be replayed after the module is denied. Purchasing is
  -- both a Store action and a billing action, so it must hold both.
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  request_payload := jsonb_build_object('service_id', p_service_id);

  existing_id := private.find_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload
  );

  if existing_id is not null then
    -- The same request already succeeded. Return the ORIGINAL purchase rather
    -- than making a second one. Everything is re-derived from the Order, which
    -- is the anchor the request id remembers.
    select * into order_row from public.orders where id = existing_id;
    if order_row.id is null then raise no_data_found; end if;

    select * into ticket_row
    from public.tickets as ticket
    where ticket.order_id = order_row.id;

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
      ticket_row.id,
      ticket_row.public_ref,
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

  -- Buying is a cheap action to repeat and an expensive one to process. The
  -- limits are generous for a real client and hostile to a loop.
  perform private.consume_rate_limit(
    'store.purchase.client.hour', actor_id::text, interval '1 hour', 10
  );
  perform private.consume_rate_limit(
    'store.purchase.client.day', actor_id::text, interval '1 day', 40
  );

  -- ---------------------------------------------------------------------------
  -- Purchasability, resolved from the catalogue and nowhere else
  -- ---------------------------------------------------------------------------
  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.archived_at is null
    and service.is_active
    and service.is_public;

  if service_row.id is null then
    -- Inactive, private, archived and non-existent are indistinguishable.
    raise exception 'WF_PURCHASE_SERVICE_UNAVAILABLE' using errcode = '42501';
  end if;

  if service_row.recurring then
    -- A recurring purchase is a subscription, and subscriptions are a separate
    -- module with their own billing lifecycle. Refusing is the honest answer.
    raise exception 'WF_PURCHASE_RECURRING_UNSUPPORTED' using errcode = 'P0001';
  end if;

  price_cents := round(service_row.price * 100)::bigint;

  if price_cents is null or price_cents <= 0 then
    raise exception 'WF_PURCHASE_SERVICE_NOT_PRICED' using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------
  -- The rail
  --
  -- The Wolf Forge Balance is the funding source. An active WF Card membership
  -- is NOT required here: a Store purchase of a one-time catalogue Service is
  -- available to every client whose balance covers it. Membership remains the
  -- ordinary invoice-settlement gate — app_pay_invoice_with_wallet is unchanged
  -- — but a purchase may not be the path that quietly requires it. The wallet is
  -- locked FOR UPDATE, so the balance and currency checks below run against a row
  -- that cannot change underneath this transaction.
  -- ---------------------------------------------------------------------------
  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> service_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < price_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = actor_company_id;

  -- ---------------------------------------------------------------------------
  -- The obligation
  --
  -- The real invoice lifecycle, walked in order rather than short-circuited.
  -- private.protect_invoice_item_history refuses to add a line to an invoice
  -- that has already been issued, so the invoice is born a draft, receives its
  -- single service line, and only then becomes a numbered, issued, collectible
  -- invoice — exactly what app_issue_invoice does for a manual one.
  -- ---------------------------------------------------------------------------
  insert into public.invoices (
    company_id, client_profile_id, status, currency,
    billing_reason, due_at,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
    created_by_profile_id, updated_by_profile_id
  ) values (
    actor_company_id, actor_id, 'draft', service_row.currency,
    'store_purchase', now(),
    price_cents, 0, 0, price_cents,
    actor_id, actor_id
  ) returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id, service_id, order_id, position, name, description,
    quantity, unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
  ) values (
    invoice_row.id, service_row.id, null, 0, service_row.name, null,
    1, price_cents, 0, false, 'awaiting_payment'
  ) returning id into invoice_item_id;

  -- From here to the Order insert this transaction is a Store purchase, and the
  -- two generic notification triggers that watch these tables stand down. The
  -- flag is transaction-local and cleared the moment fulfillment exists.
  perform set_config('app.wf_store_purchase_order', 'on', true);

  update public.invoices
  set status = 'unpaid',
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  -- ---------------------------------------------------------------------------
  -- Settlement, through the existing hardened primitive
  --
  -- settle_invoice_payment writes the payment row, flips the invoice to 'paid'
  -- once the balance reaches zero and moves service lines from awaiting_payment
  -- to pending. It also refuses to over-collect. Reusing it is what keeps this
  -- purchase inside the one money ledger the platform already has.
  -- ---------------------------------------------------------------------------
  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    invoice_row.id,
    price_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  select * into invoice_row from public.invoices where id = invoice_row.id;

  if invoice_row.status <> 'paid' then
    -- Unreachable with a single full-value payment, and worth an explicit stop
    -- rather than an assumption: fulfillment may not begin on a part-paid
    -- invoice.
    raise exception 'WF_PURCHASE_NOT_SETTLED' using errcode = 'P0001';
  end if;

  -- The wallet is not writable by an authenticated session on request.
  -- private.enforce_company_wallet_permission opens exactly one narrow gate: a
  -- transaction that names a succeeded wolf_forge_wallet payment it created, for
  -- its own company, debiting the wallet by precisely that payment's amount and
  -- no more. The trigger waives active membership for a payment that settles a
  -- store_purchase invoice — which is what this invoice is — so a funded
  -- non-member can buy. Naming the payment here is what makes the debit legal,
  -- and the trigger re-verifies every one of those facts independently — this
  -- RPC cannot widen its own permission.
  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - price_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents, balance_after_cents,
    currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -price_cents, wallet_row.balance_cents,
    wallet_row.currency, 'invoice_payment',
    left('Store purchase — ' || service_row.name, 240),
    invoice_row.id, payment_row.id
  );

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  -- ---------------------------------------------------------------------------
  -- Fulfillment becomes real, and only now
  --
  -- Naming the payment is what lets private.enforce_order_permission accept an
  -- Order from a client session, and it accepts nothing else: the payment must
  -- be settled, the invoice paid and store_purchase, the company the caller's
  -- own, and the Service the one this Order provisions.
  -- ---------------------------------------------------------------------------
  perform set_config('app.wf_store_purchase_payment_id', payment_row.id::text, true);

  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title, status, priority, notes
  ) values (
    actor_company_id,
    service_row.id,
    -- Unassigned on purpose. Who owns fulfillment is William's decision.
    null,
    left(service_row.name, 500),
    'pending',
    'normal',
    null
  ) returning * into order_row;

  perform set_config('app.wf_store_purchase_payment_id', '', true);
  perform set_config('app.wf_store_purchase_order', '', true);

  -- The line item now names the Order it provisioned. The invoice_items CHECK
  -- only permits 'provisioned' together with an order_id, so this pair of facts
  -- can never drift apart.
  update public.invoice_items
  set order_id = order_row.id,
      fulfillment_status = 'provisioned'
  where id = invoice_item_id;

  insert into public.tickets (
    company_id, client_profile_id, subject, status, priority,
    assigned_to_profile_id, created_by_profile_id, order_id
  ) values (
    actor_company_id,
    actor_id,
    left('New Service Purchase — ' || service_row.name, 500),
    -- The exact stored enum behind the "Waiting on team" label.
    'waiting_on_team',
    'normal',
    null,
    actor_id,
    order_row.id
  ) returning * into ticket_row;

  -- The opening message is authored by the platform, not by the client, and the
  -- schema can already say so: author_type 'system' requires a null author, so
  -- nothing here pretends a person typed it. Visibility stays 'client' because
  -- the purchaser is entitled to see the record of what they bought.
  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    ticket_row.id,
    null,
    'system',
    'initial_request',
    'client',
    'New service purchase received.' || chr(10) || chr(10)
      || 'Client: ' || coalesce(nullif(company_name, ''), 'Unknown company') || chr(10)
      || 'Service: ' || service_row.name || chr(10)
      || 'Amount: ' || invoice_row.currency || ' '
        || to_char(price_cents::numeric / 100, 'FM999999999999990.00') || chr(10)
      || 'Payment method: Wolf Forge Balance' || chr(10)
      || 'Invoice: #WF-' || lpad(invoice_row.invoice_number::text, 4, '0') || chr(10)
      || 'Project: #' || order_row.order_number::text || ' ' || order_row.title || chr(10)
      -- Stamped in the database's own clock, so it is labelled rather than left
      -- to disagree silently with the Ticket's locally-rendered created time.
      || 'Purchased: ' || to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY')
        || ' (UTC)' || chr(10) || chr(10)
      || 'The client has successfully completed payment. This ticket is waiting '
      || 'for the Wolf Forge team to begin fulfillment.',
    p_request_id
  );

  -- ---------------------------------------------------------------------------
  -- Investment intent
  --
  -- A purchase resolves an interest rather than leaving it open as an unanswered
  -- buying signal. This is a system transition on a completed sale, not the
  -- client editing William's triage — D-088's rule that a client re-adding an
  -- item must not reopen a decision is about the cart, and is untouched. The row
  -- is preserved: history is never deleted here.
  -- ---------------------------------------------------------------------------
  update public.service_interests
  set status = 'closed',
      in_cart = false,
      removed_at = coalesce(removed_at, now()),
      last_activity_at = now()
  where company_id = actor_company_id
    and service_id = service_row.id
    and status not in ('closed', 'not_interested');

  -- ---------------------------------------------------------------------------
  -- Audit trail. record_authenticated_activity requires an internal actor, so a
  -- client-driven event writes the same table directly, exactly as
  -- app_pay_invoice_with_wallet does.
  -- ---------------------------------------------------------------------------
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
      'ticket_id', ticket_row.id,
      'amount_cents', price_cents,
      'currency', invoice_row.currency,
      'payment_method', 'wolf_forge_wallet'
    )
  );

  perform private.remember_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload, order_row.id
  );

  return query
  select
    order_row.id,
    order_row.order_number,
    ticket_row.id,
    ticket_row.public_ref,
    invoice_row.id,
    invoice_row.invoice_number,
    payment_row.id,
    price_cents,
    invoice_row.currency,
    wallet_row.balance_cents,
    service_row.name,
    false;
end;
$$;

revoke all on function public.app_purchase_service_with_balance(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_purchase_service_with_balance(uuid, uuid)
  to authenticated;

comment on function public.app_purchase_service_with_balance(uuid, uuid) is
  'Atomic Store purchase: issues and settles an invoice from the Wolf Forge Balance, then provisions the fulfillment Order and its single waiting_on_team Ticket in the same transaction. Company, price and balance are all server-resolved; the caller supplies a service id and a request id. Retry-safe on request id — a replayed request returns the original purchase and moves no money.';
