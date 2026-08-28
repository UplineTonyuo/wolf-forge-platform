-- Wolf Forge Platform — Store & invoice coupons + WF Card gate removal for
-- ordinary invoice settlement
--
-- Product decisions implemented here (D-098, D-099):
--
--   1. A client may pay an eligible Store service OR an issued invoice with their
--      Wolf Forge Balance and a coupon created by William/admin. The coupon is
--      re-resolved and its discount recomputed entirely inside the database on
--      every quote and every payment; the browser never supplies a price or a
--      discount.
--   2. WF Card membership is no longer required for ordinary invoice settlement.
--      app_pay_invoice_with_wallet and the wallet-debit trigger drop the
--      membership predicate for EVERY invoice, not only store purchases. All
--      other authorization facts (authentication, company ownership, invoice
--      access and state, balance, currency, payment amount authority, wallet
--      transaction protections, idempotency) are unchanged.
--
-- The coupon machinery REUSES the existing architecture:
--
--   - private.calculate_coupon (20260813110000) is the side-effect-free
--     validation/calculation boundary. Cart money for a purchase is the
--     catalogue price; for an invoice it is the invoice's own service lines.
--   - public.coupon_redemptions is the append-only redemption ledger. A
--     redemption row is written ONLY inside a successful purchase/payment
--     transaction, so a failed or rolled-back payment never consumes a coupon
--     and a replayed request id never double-consumes one (the redemption is
--     keyed on the same request id the payment idempotency uses).
--   - "Apply" is a quote only: the new app_quote_* RPCs validate and compute,
--     write nothing, and return the same failure vocabulary as app_validate_coupon.
--
-- Truthful accounting: an invoice that is paid with a coupon records the
-- discount in its own discount_total_cents / total_cents (the same columns the
-- Store purchase already writes), so Subtotal / Discount / Final total / Amount
-- paid / Payment method / Coupon used are all durably explainable from the
-- existing tables. protect_invoice_record gains one tightly-scoped, re-verified
-- exception for that movement; nothing else about issued-invoice immutability
-- changes.

-- =============================================================================
-- 1. Shared coupon resolution (side-effect free, capped)
--
-- Wraps private.calculate_coupon with the caller's maximum discount in cents so
-- quote and payment agree even on an invoice whose existing line discounts
-- nearly exhaust the subtotal. Does not write anything: the quote RPCs return
-- its row, and the payment RPCs insert the redemption only after they know the
-- payment can succeed.
-- =============================================================================

create or replace function private.resolve_coupon_application(
  p_coupon_code text,
  p_cart_items jsonb,
  p_cart_subtotal numeric,
  p_actor_profile_id uuid,
  p_actor_company_id uuid,
  p_max_discount_cents bigint
)
returns table (
  valid boolean,
  failure_code text,
  coupon_id uuid,
  discount_cents bigint,
  discount_amount numeric,
  original_cart_subtotal numeric,
  eligible_subtotal numeric,
  resulting_cart_subtotal numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  raw_discount numeric;
  capped_cents bigint;
begin
  if p_coupon_code is null or private.normalize_coupon_code(p_coupon_code) = '' then
    return query
    select false, 'INVALID_CODE', null::uuid, 0::bigint, 0::numeric,
      0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  result := private.calculate_coupon(
    p_coupon_code,
    p_cart_items,
    p_cart_subtotal,
    p_actor_profile_id,
    p_actor_company_id,
    -- new_customers_only coupons are deliberately deferred (the same decision
    -- app_validate_coupon makes): the current order history does not prove paid
    -- commerce, so no server-side new-customer assertion is invented here.
    null
  );

  if (result ->> 'valid')::boolean is not true then
    return query
    select false,
      coalesce(result ->> 'failure_code', 'INVALID_CODE'),
      null::uuid,
      0::bigint,
      0::numeric,
      p_cart_subtotal,
      coalesce((result ->> 'eligible_subtotal')::numeric, 0),
      p_cart_subtotal;
    return;
  end if;

  raw_discount := coalesce((result ->> 'discount_amount')::numeric, 0);
  capped_cents := least(round(raw_discount * 100)::bigint, greatest(p_max_discount_cents, 0));
  if capped_cents < 0 then
    capped_cents := 0;
  end if;

  -- A coupon that would zero the payable is not applicable: the platform does
  -- not record free payments (invoice_payments require a positive amount), so
  -- quoting or applying a discount that covers the entire payable would produce
  -- a $0 transaction the ledger cannot represent. Reject it up front.
  if capped_cents > 0 and p_max_discount_cents > 0 and capped_cents >= p_max_discount_cents then
    return query
    select false, 'DISCOUNT_EXCEEDS_TOTAL', null::uuid, 0::bigint, 0::numeric,
      p_cart_subtotal, coalesce((result ->> 'eligible_subtotal')::numeric, 0), p_cart_subtotal;
    return;
  end if;

  return query
  select
    true,
    null::text,
    (result ->> 'coupon_id')::uuid,
    capped_cents,
    capped_cents::numeric / 100,
    p_cart_subtotal,
    coalesce((result ->> 'eligible_subtotal')::numeric, 0),
    p_cart_subtotal - (capped_cents::numeric / 100);
end;
$$;

revoke all on function private.resolve_coupon_application(
  text, jsonb, numeric, uuid, uuid, bigint
) from public, anon, authenticated, service_role;

comment on function private.resolve_coupon_application(text, jsonb, numeric, uuid, uuid, bigint) is
  'Side-effect-free coupon quote shared by the Store and invoice payment paths. Capped at the caller-supplied maximum so an issued invoice with heavy line discounts cannot over-discount. new_customers_only coupons stay deferred exactly as app_validate_coupon defers them.';

-- =============================================================================
-- 2. Store coupon quote
--
-- The browser sends a service id and a coupon code. Price, company and every
-- eligibility fact are re-resolved here from the catalogue and the session; the
-- caller never supplies a price. Side-effect free.
-- =============================================================================

create or replace function public.app_quote_store_coupon(
  p_service_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  service_row public.services;
  price_cents bigint;
  application record;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Same module boundary as the purchase itself: quoting is a Store AND a
  -- billing action.
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

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

  select * into application
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

  if not application.valid then
    return jsonb_build_object('valid', false, 'failure_code', application.failure_code);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', application.coupon_id,
    'discount_cents', application.discount_cents,
    'original_subtotal_cents', price_cents,
    'eligible_subtotal_cents', round(application.eligible_subtotal * 100)::bigint,
    'resulting_subtotal_cents', round(application.resulting_cart_subtotal * 100)::bigint
  );
end;
$$;

revoke all on function public.app_quote_store_coupon(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_quote_store_coupon(uuid, text)
  to authenticated;

comment on function public.app_quote_store_coupon(uuid, text) is
  'Side-effect-free Store coupon quote. The catalogue price and the caller''s company are resolved server-side; the coupon is validated but never consumed.';

-- =============================================================================
-- 3. Invoice coupon quote
--
-- The browser sends an invoice id and a coupon code. The cart is the invoice''s
-- own service lines at their recorded unit prices, so eligibility and discount
-- are computed against the document the client is actually paying. Side-effect
-- free.
-- =============================================================================

create or replace function public.app_quote_invoice_coupon(
  p_invoice_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  invoice_row public.invoices;
  amounts record;
  cart_items jsonb;
  cart_subtotal numeric;
  cap_cents bigint;
  application record;
begin
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if amounts.balance_due_cents is null or amounts.balance_due_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select
    jsonb_agg(jsonb_build_object(
      'service_id', item.service_id,
      'quantity', item.quantity,
      'unit_amount', (item.unit_price_cents - item.unit_discount_cents)::numeric / 100,
      'billing_context', 'one_time'
    )),
    coalesce(sum((item.unit_price_cents - item.unit_discount_cents) * item.quantity), 0)::numeric / 100
  into cart_items, cart_subtotal
  from public.invoice_items as item
  where item.invoice_id = p_invoice_id
    and item.service_id is not null;

  if cart_items is null then
    -- An invoice with no service lines has nothing an eligible coupon can touch.
    return jsonb_build_object('valid', false, 'failure_code', 'NOT_APPLICABLE');
  end if;

  cap_cents := least(
    amounts.balance_due_cents,
    invoice_row.subtotal_cents - invoice_row.discount_total_cents
  );

  select * into application
  from private.resolve_coupon_application(
    p_coupon_code,
    cart_items,
    cart_subtotal,
    actor_id,
    actor_company_id,
    cap_cents
  );

  if not application.valid then
    return jsonb_build_object('valid', false, 'failure_code', application.failure_code);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', application.coupon_id,
    'discount_cents', application.discount_cents,
    'original_subtotal_cents', amounts.balance_due_cents,
    'eligible_subtotal_cents', round(application.eligible_subtotal * 100)::bigint,
    'resulting_subtotal_cents', amounts.balance_due_cents - application.discount_cents
  );
end;
$$;

revoke all on function public.app_quote_invoice_coupon(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_quote_invoice_coupon(uuid, text)
  to authenticated;

comment on function public.app_quote_invoice_coupon(uuid, text) is
  'Side-effect-free invoice coupon quote. The cart is the invoice''s own service lines; the discount is capped so it can never exceed the payable balance. The coupon is validated but never consumed.';

-- =============================================================================
-- 4. Issued-invoice immutability gains one narrow, re-verified exception
--
-- protect_invoice_record forbids changing the financial contents of any issued
-- invoice. A client paying an issued invoice with a coupon must fold the
-- server-validated discount into the invoice''s own discount_total_cents and
-- total_cents — the same columns the Store purchase writes at creation — so the
-- document stays the single truthful source of Subtotal / Discount / Final total.
--
-- The exception is keyed on a transaction-local flag that ONLY
-- app_pay_invoice_with_wallet sets, naming the coupon_redemptions row it wrote
-- in the same transaction. The trigger re-derives every fact itself: only the
-- two discount/total columns may move, by exactly that redemption''s recorded
-- discount, for the same company. A hand-set flag naming any other redemption
-- (or a raw UPDATE from a session with the flag unset) still fails closed.
-- =============================================================================

create or replace function private.protect_invoice_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  flag_value text;
  redemption_id uuid;
  redemption_row public.coupon_redemptions;
  discount_cents bigint;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued invoice history cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if new.id <> old.id
    or new.created_at <> old.created_at
    or new.created_by_profile_id <> old.created_by_profile_id
  then
    raise exception 'invoice identity and creation history are immutable' using errcode = '55000';
  end if;

  if old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number then
    raise exception 'issued invoice number is immutable' using errcode = '55000';
  end if;

  if old.status <> 'draft' and (
    new.company_id is distinct from old.company_id
    or new.client_profile_id is distinct from old.client_profile_id
    or new.currency is distinct from old.currency
    or new.subtotal_cents is distinct from old.subtotal_cents
    or new.discount_total_cents is distinct from old.discount_total_cents
    or new.tax_total_cents is distinct from old.tax_total_cents
    or new.total_cents is distinct from old.total_cents
  ) then
    -- Everything except a coupon discount movement is still refused. For the
    -- exception, every other column must be byte-identical and the movement
    -- must match the named redemption exactly.
    if new.company_id = old.company_id
      and new.client_profile_id is not distinct from old.client_profile_id
      and new.currency = old.currency
      and new.subtotal_cents = old.subtotal_cents
      and new.tax_total_cents = old.tax_total_cents
    then
      begin
        flag_value := nullif(
          current_setting('app.wf_invoice_coupon_discount_id', true), ''
        );
        if flag_value is not null then
          redemption_id := flag_value::uuid;
          select redemption.* into redemption_row
          from public.coupon_redemptions as redemption
          where redemption.id = redemption_id;

          if redemption_row.id is not null
            and redemption_row.company_id = new.company_id
          then
            discount_cents := round(redemption_row.discount_amount * 100)::bigint;
            if new.discount_total_cents = old.discount_total_cents + discount_cents
              and old.total_cents - new.total_cents = discount_cents
              and new.total_cents >= 0
              and new.discount_total_cents <= new.subtotal_cents
            then
              return new;
            end if;
          end if;
        end if;
      exception
        when others then
          null;
      end;
    end if;

    raise exception 'issued invoice financial contents are immutable' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_invoice_record()
  from public, anon, authenticated, service_role;

comment on function private.protect_invoice_record() is
  'Issued-invoice immutability, with one exception: a client wallet payment may fold a server-validated coupon discount into discount_total_cents/total_cents when the transaction names the same-company coupon_redemptions row it just wrote and the movement matches that row exactly. Every other financial change remains refused.';

-- =============================================================================
-- 5. The wallet debit loses its membership gate for every invoice
--
-- WF Card membership is no longer required to settle an ordinary invoice from
-- the Wolf Forge Balance. The trigger still refuses every wallet write that is
-- not a real, succeeded, wolf_forge_wallet payment the caller created, for their
-- own company, debiting exactly that payment''s amount and never below zero.
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
  'Wallet write authorization. A browser role may not touch a wallet; the one exception is a transaction that names a succeeded wolf_forge_wallet payment it created, for its own company, debiting exactly that payment''s amount and never below zero. No WF Card membership is required for any invoice settlement.';

-- =============================================================================
-- 6. Store purchase with an optional coupon
--
-- The browser sends a service id, a request id and an optional coupon code.
-- Company, catalogue price, coupon validity and final amount are all re-resolved
-- here. The actual debited amount is server catalogue price minus the
-- server-calculated valid coupon discount. The coupon redemption is written in
-- this same transaction, so it consumes the coupon exactly when (and only when)
-- the purchase succeeds.
-- =============================================================================

-- The old two-argument signature must go: leaving it beside a three-argument
-- function with a default would make every two-argument call ambiguous (42725).
drop function if exists public.app_purchase_service_with_balance(uuid, uuid);

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
  ticket_row public.tickets;
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
  -- invalid at purchase time fails the whole purchase — it is never silently
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
    left('Store purchase — ' || service_row.name, 240),
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

  insert into public.tickets (
    company_id, client_profile_id, subject, status, priority,
    assigned_to_profile_id, created_by_profile_id, order_id
  ) values (
    actor_company_id,
    actor_id,
    left('New Service Purchase — ' || service_row.name, 500),
    'waiting_on_team',
    'normal',
    null,
    actor_id,
    order_row.id
  ) returning * into ticket_row;

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
        || to_char(final_price_cents::numeric / 100, 'FM999999999999990.00') || chr(10)
      || 'Payment method: Wolf Forge Balance' || chr(10)
      || 'Invoice: #WF-' || lpad(invoice_row.invoice_number::text, 4, '0') || chr(10)
      || 'Project: #' || order_row.order_number::text || ' ' || order_row.title || chr(10)
      || 'Purchased: ' || to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY')
        || ' (UTC)' || chr(10) || chr(10)
      || 'The client has successfully completed payment. This ticket is waiting '
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
      'ticket_id', ticket_row.id,
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
    ticket_row.id,
    ticket_row.public_ref,
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
  'Atomic Store purchase with an optional coupon. Company, catalogue price, coupon validity, final amount and wallet balance are all server-resolved; the caller supplies a service id, a request id and optionally a coupon code. The exact debited amount is catalogue price minus the server-calculated coupon discount. Retry-safe on request id — a replay returns the original purchase, moves no money and does not consume the coupon again.';

-- =============================================================================
-- 7. Invoice settlement with an optional coupon, WF Card gate removed
--
-- A client may pay their own company''s collectible invoice from the Wolf Forge
-- Balance with no WF Card membership. The debit is always the invoice''s own
-- balance due, derived by the database; a valid coupon folds the discount into
-- the invoice''s discount_total_cents/total_cents before settlement, so the
-- invoice is marked paid for exactly the discounted amount and the redemption is
-- written in the same transaction.
-- =============================================================================

drop function if exists public.app_pay_invoice_with_wallet(uuid, uuid);

create or replace function public.app_pay_invoice_with_wallet(
  p_request_id uuid,
  p_invoice_id uuid,
  p_coupon_code text default null
)
returns table (
  payment_id uuid,
  wallet_transaction_id uuid,
  wallet_balance_cents bigint,
  invoice_balance_cents bigint
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
  invoice_row public.invoices;
  wallet_row public.company_wallets;
  payment_row public.invoice_payments;
  wallet_transaction_row public.company_wallet_transactions;
  amounts record;
  debit_cents bigint;
  cart_items jsonb;
  cart_subtotal numeric;
  cap_cents bigint;
  coupon_application record;
  coupon_discount_cents bigint := 0;
  coupon_redemption_id uuid;
begin
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null then
    raise exception 'WF_CARD_INVALID_PAYMENT_REQUEST' using errcode = '22023';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Reauthorize before the idempotency lookup (H-04): a payment made while
  -- access was granted must not remain replayable after invoices.view is denied.
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  request_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'coupon_code', nullif(btrim(p_coupon_code), '')
  );

  existing_id := private.find_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload
  );
  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment where payment.id = existing_id;
    select transaction.* into wallet_transaction_row
    from public.company_wallet_transactions as transaction
    where transaction.invoice_payment_id = existing_id;
    select * into amounts from private.invoice_amounts(payment_row.invoice_id);

    if payment_row.id is null or wallet_transaction_row.id is null then raise no_data_found; end if;
    return query select payment_row.id, wallet_transaction_row.id,
      wallet_transaction_row.balance_after_cents, amounts.balance_due_cents;
    return;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
  for update;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  debit_cents := amounts.balance_due_cents;
  if debit_cents is null or debit_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  -- Optional coupon, resolved server-side against the invoice''s own lines.
  -- The discount folds into the issued invoice''s discount/total columns
  -- (through the protect_invoice_record exception above) before settlement, so
  -- the exact debited amount is the discounted balance due.
  if nullif(btrim(p_coupon_code), '') is not null then
    select
      jsonb_agg(jsonb_build_object(
        'service_id', item.service_id,
        'quantity', item.quantity,
        'unit_amount', (item.unit_price_cents - item.unit_discount_cents)::numeric / 100,
        'billing_context', 'one_time'
      )),
      coalesce(sum((item.unit_price_cents - item.unit_discount_cents) * item.quantity), 0)::numeric / 100
    into cart_items, cart_subtotal
    from public.invoice_items as item
    where item.invoice_id = p_invoice_id
      and item.service_id is not null;

    if cart_items is null then
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    cap_cents := least(
      debit_cents,
      invoice_row.subtotal_cents - invoice_row.discount_total_cents
    );

    select * into coupon_application
    from private.resolve_coupon_application(
      p_coupon_code,
      cart_items,
      cart_subtotal,
      actor_id,
      actor_company_id,
      cap_cents
    );

    if not coupon_application.valid then
      if coupon_application.failure_code = 'ALREADY_REDEEMED' then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    coupon_discount_cents := coupon_application.discount_cents;
  end if;

  if coupon_discount_cents > 0 then
    begin
      insert into public.coupon_redemptions (
        coupon_id, customer_profile_id, company_id, request_id, currency,
        original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
      ) values (
        coupon_application.coupon_id, actor_id, actor_company_id, p_request_id,
        invoice_row.currency,
        coupon_application.original_cart_subtotal,
        coupon_application.eligible_subtotal,
        coupon_application.discount_amount,
        coupon_application.resulting_cart_subtotal
      ) returning id into coupon_redemption_id;
    exception
      when unique_violation then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
    end;

    perform set_config('app.wf_invoice_coupon_discount_id', coupon_redemption_id::text, true);
    update public.invoices
    set discount_total_cents = discount_total_cents + coupon_discount_cents,
        total_cents = total_cents - coupon_discount_cents,
        updated_by_profile_id = actor_id
    where id = p_invoice_id;
    perform set_config('app.wf_invoice_coupon_discount_id', '', true);

    -- The amount to collect is now the discounted balance due.
    select balance_due_cents into debit_cents from private.invoice_amounts(p_invoice_id);
  end if;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> invoice_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < debit_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    p_invoice_id,
    debit_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - debit_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents,
    balance_after_cents, currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -debit_cents,
    wallet_row.balance_cents, wallet_row.currency, 'invoice_payment',
    format('WF Card payment for invoice #%s', invoice_row.invoice_number),
    invoice_row.id, payment_row.id
  ) returning * into wallet_transaction_row;

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'company',
    actor_company_id,
    'company.wallet_invoice_paid',
    'Paid an invoice with the Wolf Forge Balance.',
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'wallet_transaction_id', wallet_transaction_row.id,
      'amount_cents', debit_cents,
      'balance_after_cents', wallet_row.balance_cents,
      'currency', wallet_row.currency,
      'coupon_redemption_id', coupon_redemption_id,
      'coupon_discount_cents', coupon_discount_cents
    )
  );

  perform private.remember_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload, payment_row.id
  );

  select * into amounts from private.invoice_amounts(p_invoice_id);
  return query select payment_row.id, wallet_transaction_row.id,
    wallet_row.balance_cents, amounts.balance_due_cents;
end;
$$;

revoke all on function public.app_pay_invoice_with_wallet(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_pay_invoice_with_wallet(uuid, uuid, text)
  to authenticated;

comment on function public.app_pay_invoice_with_wallet(uuid, uuid, text) is
  'Authenticated client-only, company-scoped, idempotent full invoice payment using the existing wallet and invoice ledgers, with an optional server-validated coupon. No WF Card membership is required. The debit is always the invoice''s own server-derived balance due (discounted when a valid coupon applies); the coupon redemption is written in the same transaction and rolls back with any failure.';

-- =============================================================================
-- 8. A Store purchase emits exactly one internal notification
--
-- notify_invoice_payment would otherwise add an "Invoice paid" row on top of the
-- fulfillment Ticket''s "New service purchase" row for the same event. It stands
-- down inside a purchase — the same transaction-local flag the other two generic
-- triggers already honour — while ordinary (manual) invoice payments, coupon or
-- not, keep firing the existing permission-scoped "Invoice paid" notification.
-- =============================================================================

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
  invoice_currency text;
  company_id uuid;
  company_name text;
  amount_label text;
  amounts record;
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

  -- A Store purchase announces itself through its fulfillment Ticket. A second
  -- invoice-payment row for the same transaction would be duplicate noise, so
  -- it stands down exactly like notify_project_created and
  -- notify_client_invoice_issued already do.
  if coalesce(
       nullif(current_setting('app.wf_store_purchase_order', true), ''),
       ''
     ) = 'on'
  then
    return new;
  end if;

  if invoice_id is null then
    return new;
  end if;

  select
    invoice_row.invoice_number,
    invoice_row.currency,
    invoice_row.company_id,
    company_row.name
  into
    invoice_number,
    invoice_currency,
    company_id,
    company_name
  from public.invoices as invoice_row
  left join public.companies as company_row
    on company_row.id = invoice_row.company_id
  where invoice_row.id = invoice_id;

  -- The payment row already exists when this trigger runs, so the ledger's own
  -- balance-due projection tells the truth about whether this payment settled
  -- the invoice: a payment that clears the balance reads as "Invoice paid", any
  -- other reads as "Invoice payment received".
  select * into amounts from private.invoice_amounts(invoice_id);

  amount_label :=
    coalesce(invoice_currency, 'USD') || ' '
    || to_char(abs(payment_amount)::numeric / 100, 'FM999999999999990.00');

  perform private.emit_internal_notification_for_permission(
    'invoices.view',
    'invoice-payment:' || new.id::text,
    'payment',
    'credit',
    case
      when amounts.balance_due_cents <= 0 then 'Invoice paid'
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

revoke all on function private.notify_invoice_payment()
  from public, anon, authenticated, service_role;

comment on function private.notify_invoice_payment() is
  'Internal, permission-scoped notification when an invoice payment succeeds. Stands down inside a Store purchase so the fulfillment Ticket is the single notification for that event; ordinary invoice payments — including Wolf Forge Balance payments with a coupon — notify invoices.view holders exactly once per payment.';
