-- Wolf Forge Platform — Remove WF Card membership requirement from Store purchases
--
-- Product decision change (D-097): a client buys an eligible one-time Service with
-- their Wolf Forge Balance needing only the Service, sufficient balance, and
-- authorization for their own company. WF Card membership is NOT a Store-purchase
-- gate; it remains the ordinary invoice-settlement gate (app_pay_invoice_with_wallet
-- is unchanged).
--
-- WHY THIS FOLLOW-UP EXISTS:
-- 20260823120000_store_service_purchase_fulfillment.sql was authored, committed and
-- deployed to hosted Supabase BEFORE this decision changed. The hosted database
-- therefore already carries the ORIGINAL version of the three functions below —
-- with the active WF Card membership gate — and a modified in-place migration is
-- never re-applied to a database that already records it. Fresh local databases get
-- the corrected 20260823120000 file; this migration brings already-deployed
-- databases to the same corrected state by redefining exactly the three functions
-- whose behaviour changed.
--
-- It is idempotent and safe to run anywhere: on a fresh database the three
-- `create or replace` statements land on already-correct bodies, and on hosted
-- they REPLACE the gated bodies.
--
-- Security posture is unchanged apart from the gate removal:
--   - the purchase RPC still re-resolves company, client role, both modules,
--     active/public/one-time Service, server price, wallet, currency, balance,
--     succeeded payment and the paid store_purchase invoice;
--   - private.enforce_order_permission still refuses arbitrary client Orders and
--     re-verifies the settled payment, the paid store_purchase invoice, its
--     Service line and the caller's own company — membership is simply no longer
--     part of the exception;
--   - private.enforce_company_wallet_permission waives its membership requirement
--     ONLY when the payment settles a store_purchase invoice (the invoice's own
--     server-set billing_reason is the discriminator, never a client flag), so
--     ordinary invoice settlement keeps its membership gate byte-for-byte.
--
-- app_pay_invoice_with_wallet is NOT touched.

-- =============================================================================
-- 1. private.enforce_order_permission — the purchase exception no longer joins
--    an active WF Card membership. Every other re-derived fact is unchanged.
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
-- 2. private.enforce_company_wallet_permission — the wallet debit keeps its
--    membership gate except for a Store purchase. The discriminator is the
--    invoice's own server-set billing_reason, never a client-settable flag.
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
-- 3. public.app_purchase_service_with_balance — the WF Card membership gate is
--    removed. Everything else (one atomic transaction, idempotency, server-derived
--    price/company/balance, fulfillment boundary) is unchanged.
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
  'Atomic Store purchase: issues and settles an invoice from the Wolf Forge Balance, then provisions the fulfillment Order and its single waiting_on_team Ticket in the same transaction. Company, price and balance are all server-resolved; the caller supplies a service id and a request id. Retry-safe on request id — a replayed request returns the original purchase and moves no money. No WF Card membership is required.';
