-- =============================================================================
-- Security Phase C2-3 — abuse/bot protection follow-up.
--
-- Two narrow frequency bounds on authenticated money/coupon surfaces, using
-- the ONE existing primitive (private.consume_rate_limit over
-- private.rate_limit_counters). No signature changes, no authorization
-- changes, no grant changes; every bucket's subject is the server-derived
-- profile id from auth.uid(), never a browser-supplied value (D-085).
--
-- 1. Coupon code probing. public.app_validate_coupon,
--    public.app_quote_store_coupon and public.app_quote_invoice_coupon accept
--    an arbitrary caller-supplied coupon code and answer whether it exists
--    and what it discounts. Without a frequency bound an authenticated
--    session could enumerate admin-created codes at PostgREST speed. All
--    three now share one per-actor allowance (15/min, 100/h, 300/day) under
--    the 'coupon.attempt.actor.*' scopes, consumed narrowest-first after the
--    authentication/module gates, so a denied caller consumes nothing.
--
-- 2. The invoice wallet-payment rail. public.app_pay_invoice_with_wallet was
--    idempotent but had no frequency bound; a scripted burst of unique
--    request ids could churn the invoice/wallet row locks endlessly. It now
--    consumes a per-actor allowance (20/min, 100/h) strictly AFTER the
--    idempotent replay short-circuit — a genuine retry is a replay and never
--    counted (D-085) — and strictly BEFORE any FOR UPDATE lock.
--
-- app_validate_coupon additionally drops its incorrect STABLE marking: a
-- function that records rate-limit counters must be VOLATILE.
-- =============================================================================

create or replace function public.app_validate_coupon(
  p_code text,
  p_cart_items jsonb,
  p_cart_subtotal numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$

declare
  actor_id uuid := (select auth.uid());
  customer_profile_id uuid;
  customer_company_id uuid;
begin
  select profile_row.id, profile_row.company_id
  into customer_profile_id, customer_company_id
  from public.profiles as profile_row
  where profile_row.id = actor_id
    and profile_row.archived_at is null;

  if customer_profile_id is null then
    raise exception 'active authentication is required'
      using errcode = '42501';
  end if;

  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

  -- The current operational orders table does not prove paid commerce history.
  -- Therefore no caller-supplied "new customer" assertion is accepted here.
  return private.calculate_coupon(
    p_code,
    p_cart_items,
    p_cart_subtotal,
    customer_profile_id,
    customer_company_id,
    null
  );
end;
$fn$;

create or replace function public.app_quote_store_coupon(
  p_service_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$

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
  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

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
$fn$;

create or replace function public.app_quote_invoice_coupon(
  p_invoice_id uuid,
  p_coupon_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$

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
  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

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
$fn$;

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
as $fn$

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

  -- C2-3. Frequency-bound the money rail itself. This sits AFTER the
  -- idempotent replay short-circuit, so retrying the same request id is
  -- answered from the request log and consumes no allowance (D-085), and
  -- BEFORE any row lock, so a scripted burst of unique request ids cannot
  -- even reach the invoice and wallet locks. Nothing else changes: the
  -- debited amount is still derived server-side and the authorization facts
  -- above are untouched.
  perform private.consume_rate_limit(
    'invoice.pay.actor.minute', actor_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'invoice.pay.actor.hour', actor_id::text, interval '1 hour', 100
  );

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
$fn$;
