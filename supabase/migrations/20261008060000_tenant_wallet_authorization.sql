-- WL-2.10 (KI-111 money portion + KI-109 wallet/payment resolution):
-- wallet, WF Card and invoice-money operations require the target to belong to
-- the caller's current Tenant.
--
-- Money model (verified, unchanged): a wallet is Client-owned
-- (company_wallets.company_id -> companies.tenant_id); the wallet ledger and
-- invoice payments inherit their Tenant through their Company / Invoice rows
-- with composite foreign keys; wf_card_memberships is Company-keyed;
-- wf_card_settings is presentation/config only (per-Tenant configuration stays
-- D-271 product work, not this slice). There is no platform-global money, and
-- no tenant_id column is added to any ledger "for symmetry" — the inheritance
-- chain is mandatory and trustworthy.
--
-- Concrete leaks closed (HIGH, verified live by the WL-2.9 attack review):
--   - app_adjust_company_balance credited / debited any Tenant's Client
--     balance by company id, and wrote the ledger row and the activity event
--     into the victim Tenant.
--   - app_get_company_wallet read any Tenant's balance (through
--     private.can_access_client_private_company, which had no Tenant scope).
--   - app_list_recent_company_wallet_transactions listed every Tenant's
--     wallet movements with Client names.
--   - app_set_wf_card_membership activated / cancelled any Tenant's Company
--     membership; app_link_company_stripe_customer linked any Company.
--   - app_record_invoice_payment / app_refund_invoice acted on any invoice
--     by id, and replay lookups could return another Tenant's payment or
--     refund rows.
--
-- KI-109 (wallet / payment portion): the client identity for portal money
-- flows was resolved from the global profiles.company_id, which can only hold
-- a Wolf Forge Client. app_pay_invoice_with_wallet,
-- app_purchase_service_with_balance, app_quote_invoice_coupon,
-- app_quote_store_coupon and the client branch of
-- private.can_access_client_private_company now resolve the Client from the
-- caller's current-Tenant membership (private.current_user_company_id()); for
-- Wolf Forge the mirrored membership makes every outcome identical. Portal
-- account context (app_get_client_account_context) resolves the same way.
-- Coupon validity internals (redemption consistency, global code lookup) stay
-- for the Coupons slice; a cross-Tenant coupon still fails closed.
--
-- Pattern (D-272): tenant_id = (select private.current_tenant_id()) on every
-- lookup of a caller-supplied id, or an equivalent membership-derived Client
-- for portal flows; foreign and missing rows behave identically. The
-- caller-supplied tenant is never trusted; money amounts, rounding, currency
-- and ledger math are untouched.
--
-- Not changed here: wf_card_settings configuration (D-271); Team Chat,
-- notifications (KI-115), coupons, subscription billing aggregates, Stripe
-- provider architecture, invoice authorization beyond the money crossing.

-- -----------------------------------------------------------------------------
-- Shared access helper (wallet reads)
-- -----------------------------------------------------------------------------

create or replace function private.can_access_client_private_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    p_company_id is not null
    and exists (
      select 1
      from public.companies as company_row
      where company_row.id = p_company_id
        and company_row.archived_at is null
        and company_row.tenant_id = (select private.current_tenant_id())
        and (
          (select private.current_user_company_id()) = p_company_id
          or (
            (select private.is_internal_user())
            and private.current_user_has_permission('client_private.read')
          )
        )
    );
$$;

-- -----------------------------------------------------------------------------
-- Clients (internal RPCs)
-- -----------------------------------------------------------------------------

create or replace function public.app_adjust_company_balance(p_request_id uuid, p_company_id uuid, p_amount_cents bigint, p_reason text default null::text)
returns public.company_wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  normalized_reason text;
  request_payload jsonb;
  existing_id uuid;
  wallet_row public.company_wallets;
  transaction_row public.company_wallet_transactions;
  new_balance bigint;
  source_value text;
  formatted_amount text;
begin
  actor_id := private.require_internal_actor();
  perform private.require_permission('client_private.manage');

  normalized_reason := nullif(btrim(p_reason), '');

  if p_request_id is null then
    raise exception 'request id is required'
      using errcode = '22023';
  end if;

  if p_amount_cents is null
    or p_amount_cents = 0
  then
    raise exception 'balance adjustment must be non-zero'
      using errcode = '22023';
  end if;

  if normalized_reason is not null
    and char_length(normalized_reason) > 240
  then
    raise exception 'balance adjustment reason is too long'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.companies as company
    where company.id = p_company_id
      and company.tenant_id = (select private.current_tenant_id())
      and company.archived_at is null
  ) then
    raise no_data_found;
  end if;

  request_payload := jsonb_build_object(
    'company_id', p_company_id,
    'amount_cents', p_amount_cents,
    'reason', normalized_reason
  );

  existing_id := private.find_create_request(
    actor_id,
    'company_wallet.adjust',
    p_request_id,
    request_payload
  );

  if existing_id is not null then
    select transaction.*
    into transaction_row
    from public.company_wallet_transactions as transaction
    join public.companies as company
      on company.id = transaction.company_id
     and company.tenant_id = (select private.current_tenant_id())
    where transaction.id = existing_id;

    if transaction_row.id is null then
      raise no_data_found;
    end if;

    return transaction_row;
  end if;

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = p_company_id
  for update;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  new_balance := wallet_row.balance_cents + p_amount_cents;

  if new_balance < 0 then
    raise exception 'insufficient client balance'
      using errcode = '22023';
  end if;

  update public.company_wallets
  set balance_cents = new_balance
  where company_id = p_company_id
  returning * into wallet_row;

  source_value := case
    when p_amount_cents > 0 then 'manual_credit'
    else 'manual_debit'
  end;

  insert into public.company_wallet_transactions (
    company_id,
    request_id,
    actor_profile_id,
    amount_cents,
    balance_after_cents,
    currency,
    source,
    reason
  )
  values (
    p_company_id,
    p_request_id,
    actor_id,
    p_amount_cents,
    new_balance,
    wallet_row.currency,
    source_value,
    normalized_reason
  )
  returning * into transaction_row;

  formatted_amount := to_char(
    abs(p_amount_cents)::numeric / 100,
    'FM999999999999990.00'
  );

  perform private.record_authenticated_activity(
    'company',
    p_company_id,
    'company.updated',
    case
      when p_amount_cents > 0 then format(
        'Added $%s to client balance.',
        formatted_amount
      )
      else format(
        'Deducted $%s from client balance.',
        formatted_amount
      )
    end,
    jsonb_build_object(
      'field', 'balance',
      'transaction_id', transaction_row.id,
      'amount_cents', p_amount_cents,
      'balance_after_cents', new_balance,
      'currency', wallet_row.currency,
      'reason', normalized_reason
    )
  );

  perform private.remember_create_request(
    actor_id,
    'company_wallet.adjust',
    p_request_id,
    request_payload,
    transaction_row.id
  );

  return transaction_row;
end;
$$;

create or replace function public.app_list_recent_company_wallet_transactions(p_limit integer default 10)
returns table(transaction_id uuid, company_id uuid, company_name text, client_name text, actor_profile_id uuid, actor_display_name text, amount_cents bigint, balance_after_cents bigint, currency text, source text, reason text, created_at timestamp with time zone, is_current_actor boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  safe_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  perform private.require_permission('client_private.read');

  return query
  select
    transaction_row.id,
    transaction_row.company_id,
    company_row.name,
    coalesce(primary_contact.name, company_row.name),
    transaction_row.actor_profile_id,
    actor_profile.display_name,
    transaction_row.amount_cents,
    transaction_row.balance_after_cents,
    transaction_row.currency,
    transaction_row.source,
    transaction_row.reason,
    transaction_row.created_at,
    transaction_row.actor_profile_id = actor_id
  from public.company_wallet_transactions as transaction_row
  join public.companies as company_row
    on company_row.id = transaction_row.company_id
   and company_row.tenant_id = (select private.current_tenant_id())
   and company_row.archived_at is null
  left join public.profiles as actor_profile
    on actor_profile.id = transaction_row.actor_profile_id
  left join lateral (
    select contact_row.name
    from public.client_contacts as contact_row
    where contact_row.company_id = transaction_row.company_id
      and contact_row.archived_at is null
    order by contact_row.is_primary desc, contact_row.created_at asc
    limit 1
  ) as primary_contact on true
  order by transaction_row.created_at desc
  limit safe_limit;
end;
$$;

create or replace function public.app_set_wf_card_membership(p_request_id uuid, p_company_id uuid, p_active boolean)
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
      and company_row.tenant_id = (select private.current_tenant_id())
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
    join public.companies as company_row
      on company_row.id = membership.company_id
     and company_row.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_link_company_stripe_customer(p_company_id uuid, p_stripe_customer_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  company_row public.companies;
  candidate text := btrim(coalesce(p_stripe_customer_id, ''));
begin
  if p_company_id is null
    or candidate = ''
    or candidate !~ '^cus_[A-Za-z0-9]+$'
  then
    raise exception 'invalid Stripe customer link input' using errcode = '22023';
  end if;

  -- Internal actor plus the existing billing capability. No client account can
  -- reach this function, and no company id supplied by a browser is trusted
  -- without that capability behind it.
  actor_id := private.require_internal_actor();
  perform private.require_permission('invoices.manage');

  select * into company_row
  from public.companies as existing
  where existing.id = p_company_id
    and existing.tenant_id = (select private.current_tenant_id())
    and existing.archived_at is null
  for update;

  if company_row.id is null then
    raise exception 'active company was not found' using errcode = '42501';
  end if;

  -- Already mapped: the stored value wins, always.
  if company_row.stripe_customer_id is not null then
    return company_row.stripe_customer_id;
  end if;

  update public.companies as target
  set stripe_customer_id = candidate
  where target.id = p_company_id
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.stripe_customer_linked',
    format('Linked %s to a Stripe customer.', company_row.name),
    jsonb_build_object('stripe_customer_id', candidate)
  );

  return company_row.stripe_customer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Wallet permission trigger: the client self-spend branch resolves the Client
-- from the current-Tenant membership, not the global profile column.
-- -----------------------------------------------------------------------------

create or replace function private.enforce_company_wallet_permission()
returns trigger
language plpgsql
security definer
set search_path to ''
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
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and (select private.current_user_company_id()) = invoice_row.company_id
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

-- -----------------------------------------------------------------------------
-- Invoice client consistency: the named client must be a client of the
-- invoice's Company through the invoice Tenant's membership, not through the
-- global profiles.company_id (KI-109; identical outcomes for Wolf Forge,
-- where the mirror keeps membership and profile in step).
-- -----------------------------------------------------------------------------

create or replace function private.require_invoice_client_consistency()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.client_profile_id is not null and not exists (
    select 1
    from public.tenant_memberships as membership_row
    join public.roles as role_row
      on role_row.id = membership_row.role_id
     and role_row.name = 'client'
    where membership_row.tenant_id = new.tenant_id
      and membership_row.profile_id = new.client_profile_id
      and membership_row.company_id = new.company_id
      and membership_row.archived_at is null
  ) then
    raise exception 'invoice client profile must be an active client in the invoice company'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Store purchase Order permission: the purchasing client is resolved through
-- the current-Tenant membership, not global profiles.company_id (KI-109; the
-- Wolf Forge mirror keeps outcomes identical).
-- -----------------------------------------------------------------------------

create or replace function private.enforce_order_permission()
returns trigger
language plpgsql
security definer
set search_path to ''
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
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and (select private.current_user_company_id()) = invoice_row.company_id
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

-- -----------------------------------------------------------------------------
-- Payment settlement and the internal payment rails
-- -----------------------------------------------------------------------------

create or replace function private.settle_invoice_payment(p_actor_id uuid, p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_status text, p_payment_method text, p_processor text default null::text, p_processor_reference text default null::text)
returns public.invoice_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  amounts record;
  remaining_balance bigint;
begin
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.profiles as profile_row
      where profile_row.id = p_actor_id and profile_row.archived_at is null
    )
  then
    raise exception 'verified payment actor is required' using errcode = '42501';
  end if;

  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
    or p_payment_method not in (
      'manual', 'card', 'bank_transfer', 'wallet', 'wolf_forge_wallet', 'other'
    )
  then
    raise exception 'invalid invoice payment' using errcode = '22023';
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;

  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status not in ('unpaid', 'payment_pending') then
    raise exception 'invoice is not open for payment' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if p_status in ('pending', 'succeeded') and p_amount_cents > amounts.balance_due_cents then
    raise exception 'invoice payment exceeds balance due' using errcode = '22023';
  end if;

  insert into public.invoice_payments (
    invoice_id, amount_cents, currency, status, payment_method, processor,
    processor_reference, settled_at, request_id, created_by_profile_id
  ) values (
    p_invoice_id, p_amount_cents, invoice_row.currency, p_status, p_payment_method,
    nullif(btrim(p_processor), ''), nullif(btrim(p_processor_reference), ''),
    case when p_status = 'succeeded' then now() else null end,
    p_request_id, p_actor_id
  ) returning * into payment_row;

  if p_status = 'pending' and invoice_row.status = 'unpaid' then
    update public.invoices
    set status = 'payment_pending', updated_by_profile_id = p_actor_id
    where id = p_invoice_id;
  elsif p_status = 'succeeded' then
    select balance_due_cents into remaining_balance
    from private.invoice_amounts(p_invoice_id);

    update public.invoices
    set status = case when remaining_balance = 0 then 'paid' else 'unpaid' end,
        invoice_number = coalesce(invoice_number, private.next_invoice_number()),
        issued_at = coalesce(issued_at, now()),
        updated_by_profile_id = p_actor_id
    where id = p_invoice_id;

    if remaining_balance = 0 then
      update public.invoice_items
      set fulfillment_status = 'pending'
      where invoice_id = p_invoice_id
        and service_id is not null
        and fulfillment_status = 'awaiting_payment';
    end if;
  end if;

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    p_actor_id,
    'invoice',
    p_invoice_id,
    'invoice.payment_recorded',
    'Recorded invoice payment.',
    jsonb_build_object(
      'payment_id', payment_row.id,
      'amount_cents', payment_row.amount_cents,
      'currency', payment_row.currency,
      'status', payment_row.status,
      'payment_method', payment_row.payment_method
    )
  );

  return payment_row;
end;
$$;

create or replace function public.app_record_invoice_payment(p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_status text default 'succeeded'::text, p_payment_method text default 'manual'::text, p_processor text default null::text, p_processor_reference text default null::text)
returns public.invoice_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.mark_paid');
  request_payload jsonb := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'amount_cents', p_amount_cents,
    'status', p_status,
    'payment_method', p_payment_method,
    'processor', nullif(btrim(p_processor), ''),
    'processor_reference', nullif(btrim(p_processor_reference), '')
  );
  existing_id uuid;
  payment_row public.invoice_payments;
begin
  existing_id := private.find_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload
  );

  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    join public.invoices as invoice_row
      on invoice_row.id = payment.invoice_id
     and invoice_row.tenant_id = (select private.current_tenant_id())
    where payment.id = existing_id;
    if payment_row.id is null then raise no_data_found; end if;
    return payment_row;
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id, p_request_id, p_invoice_id, p_amount_cents, p_status,
    p_payment_method, p_processor, p_processor_reference
  );

  perform private.remember_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload, payment_row.id
  );
  return payment_row;
end;
$$;

create or replace function public.app_refund_invoice(p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_invoice_payment_id uuid default null::uuid, p_status text default 'succeeded'::text, p_processor text default null::text, p_processor_reference text default null::text)
returns public.invoice_refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.refund');
  normalized_reason text := nullif(btrim(p_reason), '');
  request_payload jsonb := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_payment_id', p_invoice_payment_id,
    'amount_cents', p_amount_cents,
    'reason', normalized_reason,
    'status', p_status,
    'processor', nullif(btrim(p_processor), ''),
    'processor_reference', nullif(btrim(p_processor_reference), '')
  );
  existing_id uuid;
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  refund_row public.invoice_refunds;
  amounts record;
  payment_refunded bigint;
begin
  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or normalized_reason is null or char_length(normalized_reason) > 500
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
  then
    raise exception 'invalid invoice refund' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'invoice.refund', p_request_id, request_payload
  );
  if existing_id is not null then
    select refund.* into refund_row
    from public.invoice_refunds as refund
    join public.invoices as replay_invoice
      on replay_invoice.id = refund.invoice_id
     and replay_invoice.tenant_id = (select private.current_tenant_id())
    where refund.id = existing_id;
    if refund_row.id is null then raise no_data_found; end if;
    return refund_row;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status <> 'paid' then
    raise exception 'only a paid invoice can be refunded' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if p_status in ('pending', 'succeeded')
    and p_amount_cents > amounts.gross_paid_cents - amounts.successful_refunds_cents
  then
    raise exception 'invoice refund exceeds refundable settled amount' using errcode = '22023';
  end if;

  if p_invoice_payment_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    where payment.id = p_invoice_payment_id
      and payment.invoice_id = p_invoice_id
      and payment.status = 'succeeded';
    if payment_row.id is null then
      raise exception 'refund payment must be a successful payment for this invoice'
        using errcode = '23514';
    end if;

    select coalesce(sum(refund.amount_cents), 0)::bigint
    into payment_refunded
    from public.invoice_refunds as refund
    where refund.invoice_payment_id = p_invoice_payment_id
      and refund.status = 'succeeded';

    if p_status in ('pending', 'succeeded')
      and p_amount_cents > payment_row.amount_cents - payment_refunded
    then
      raise exception 'refund exceeds the selected payment refundable amount'
        using errcode = '22023';
    end if;
  end if;

  insert into public.invoice_refunds (
    invoice_id, invoice_payment_id, amount_cents, currency, reason, status,
    processor, processor_reference, refunded_at, request_id, created_by_profile_id
  ) values (
    p_invoice_id, p_invoice_payment_id, p_amount_cents, invoice_row.currency,
    normalized_reason, p_status, nullif(btrim(p_processor), ''),
    nullif(btrim(p_processor_reference), ''),
    case when p_status = 'succeeded' then now() else null end,
    p_request_id, actor_id
  ) returning * into refund_row;

  perform private.record_authenticated_activity(
    'invoice', p_invoice_id, 'invoice.refunded', 'Recorded invoice refund.',
    jsonb_build_object(
      'refund_id', refund_row.id,
      'invoice_payment_id', refund_row.invoice_payment_id,
      'amount_cents', refund_row.amount_cents,
      'currency', refund_row.currency,
      'reason', refund_row.reason,
      'status', refund_row.status
    )
  );
  perform private.remember_create_request(
    actor_id, 'invoice.refund', p_request_id, request_payload, refund_row.id
  );
  return refund_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Portal money flows: the Client comes from the current-Tenant membership
-- (KI-109 wallet / payment portion), never from global profiles.company_id.
-- -----------------------------------------------------------------------------

create or replace function public.app_pay_invoice_with_wallet(p_request_id uuid, p_invoice_id uuid, p_coupon_code text default null::text)
returns table(payment_id uuid, wallet_transaction_id uuid, wallet_balance_cents bigint, invoice_balance_cents bigint)
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

  actor_company_id := (select private.current_user_company_id());

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
    from public.invoice_payments as payment
    join public.invoices as replay_invoice
      on replay_invoice.id = payment.invoice_id
     and replay_invoice.company_id = actor_company_id
    where payment.id = existing_id;
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
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
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

create or replace function public.app_purchase_service_with_balance(p_request_id uuid, p_service_id uuid, p_coupon_code text default null::text)
returns table(order_id uuid, order_number bigint, ticket_id uuid, ticket_public_ref text, invoice_id uuid, invoice_number bigint, payment_id uuid, amount_cents bigint, currency text, wallet_balance_cents bigint, service_name text, replayed boolean)
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

  actor_company_id := (select private.current_user_company_id());

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
    select * into order_row
    from public.orders
    where id = existing_id
      and company_id = actor_company_id;
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
    and service.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_quote_invoice_coupon(p_invoice_id uuid, p_coupon_code text)
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

  actor_company_id := (select private.current_user_company_id());

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
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null;

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

create or replace function public.app_quote_store_coupon(p_service_id uuid, p_coupon_code text)
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

  actor_company_id := (select private.current_user_company_id());

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
    and service.is_public
    and service.tenant_id = (select private.current_tenant_id());

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

-- -----------------------------------------------------------------------------
-- Portal account context: the Client comes from the current-Tenant membership.
-- -----------------------------------------------------------------------------

create or replace function public.app_get_client_account_context()
returns table(profile_id uuid, company_id uuid, display_name text, company_name text)
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  return query
  select profile_row.id, company_row.id, profile_row.display_name, company_row.name
  from public.profiles as profile_row
  join public.tenant_memberships as membership_row
    on membership_row.profile_id = profile_row.id
   and membership_row.tenant_id = (select private.current_tenant_id())
   and membership_row.archived_at is null
  join public.roles as role_row
    on role_row.id = membership_row.role_id
   and role_row.name = 'client'
  join public.companies as company_row
    on company_row.id = membership_row.company_id
   and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null;

  if not found then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: money tables that grant direct SELECT to authenticated
-- -----------------------------------------------------------------------------

alter policy wf_card_memberships_authorized_select on public.wf_card_memberships
  using (
    (company_id = (select private.current_user_company_id())
      and public.app_has_permission('invoices.view'))
    or ((select private.is_internal_user())
      and public.app_has_permission('client_private.read')
      and exists (
        select 1
        from public.companies as company_row
        where company_row.id = wf_card_memberships.company_id
          and company_row.tenant_id = (select private.current_tenant_id())
      ))
  );

alter policy invoice_payments_authorized_internal_select on public.invoice_payments
  using ((select private.is_internal_user())
    and (public.app_has_permission('invoices.view') or public.app_has_permission('invoices.manage'))
    and exists (
      select 1
      from public.invoices as invoice_row
      where invoice_row.id = invoice_payments.invoice_id
        and invoice_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy invoice_refunds_authorized_internal_select on public.invoice_refunds
  using ((select private.is_internal_user())
    and (public.app_has_permission('invoices.view') or public.app_has_permission('invoices.manage'))
    and exists (
      select 1
      from public.invoices as invoice_row
      where invoice_row.id = invoice_refunds.invoice_id
        and invoice_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy subscription_payment_methods_internal_select on public.subscription_payment_methods
  using ((select private.is_internal_user())
    and (public.app_has_permission('subscriptions.manage') or public.app_has_permission('subscriptions.billing'))
    and exists (
      select 1
      from public.subscriptions as subscription_row
      where subscription_row.id = subscription_payment_methods.subscription_id
        and subscription_row.tenant_id = (select private.current_tenant_id())
    ));
